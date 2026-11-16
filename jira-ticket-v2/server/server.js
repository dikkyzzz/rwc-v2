// server/server.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');
const CHARTJS_CONTENT = fs.readFileSync(path.join(__dirname, 'chart.min.js'), 'utf8');
const crypto = require('crypto');
const db = require('./config/database'); // Update ke MySQL config
const AdmZip = require('adm-zip');
const puppeteer = require('puppeteer');
const { createReport } = require('docx-templates');

// Each request gets its own browser — simple and reliable
async function launchBrowserSafe() {
    return puppeteer.launch({
        headless: true,
        protocolTimeout: 120000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
}
function releaseBrowser(browser) {}

const app = express();
const PORT = process.env.PORT || 7000;

// WDQMS v2 (FastAPI + Next.js) menggantikan aplikasi PHP v1.
const WDQMS_V2_API_URL = (process.env.WDQMS_V2_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
const WDQMS_V2_WEB_URL = (process.env.WDQMS_V2_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');

function isSecureRequest(req) {
    if (req.secure || req.protocol === 'https') {
        return true;
    }

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    if (forwardedProto === 'https') {
        return true;
    }

    return !!(req.connection && req.connection.encrypted);
}

// Middleware
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.use(express.json());
app.use('/logowmo.png', express.static(path.join(__dirname, '../logowmo.png')));
app.use('/logo-bmkg.webp', express.static(path.join(__dirname, '../logo-bmkg.webp')));
app.use('/logo-update.svg', express.static(path.join(__dirname, '../logo-update.svg')));
app.use('/logofull.svg', express.static(path.join(__dirname, '../logo-update.svg')));
app.use('/logo-full.svg', express.static(path.join(__dirname, '../logo-update.svg')));
app.use('/logo-icon.svg', express.static(path.join(__dirname, '../logo-icon.svg')));
app.use('/logo-bmkg.png', express.static(path.join(__dirname, '../logo-bmkg.webp')));
app.use('/', express.static(path.join(__dirname, '../../landingpage')));
// Aplikasi WDQMS v1 (PHP) sudah dipindahkan ke WDQMS v2. Arahkan semua
// permintaan /wdqms/* ke frontend v2 (Next.js).
app.use('/wdqms', (req, res) => {
    const suffix = req.originalUrl.replace(/^\/wdqms/, '') || '/';
    const target = suffix.startsWith('/') ? suffix : '/' + suffix;
    res.redirect(302, WDQMS_V2_WEB_URL + target);
});

// === AUTHENTICATION SYSTEM ===

// Simple in-memory session store (untuk production, gunakan Redis atau database)
const sessions = new Map();
const monitoringSessions = new Map();
let monthlyReportGenerationInProgress = false;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MONITORING_SESSION_COOKIE = 'monitoring_session';
const DEFAULT_MONITORING_PASSWORD = 'ChangeMe123!';
const MONITORING_PRIVILEGED_SEEDS = [
    { email: 'superadmin@rwc.local', displayName: 'Super Admin', role: 'super_admin' },
    { email: 'rwc.indonesia@rwc.local', displayName: 'RWC Indonesia', role: 'admin' },
    { email: 'wmo.secretariat@rwc.local', displayName: 'WMO Secretariat', role: 'admin' },
    { email: 'wmo.centre@rwc.local', displayName: 'WMO Centre', role: 'admin' }
];

// Generate session token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        return false;
    }

    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) {
        return false;
    }

    const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const storedBuffer = Buffer.from(hash, 'hex');
    const computedBuffer = Buffer.from(computedHash, 'hex');

    if (storedBuffer.length !== computedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(storedBuffer, computedBuffer);
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    return cookieHeader.split(';').reduce((cookies, part) => {
        const trimmed = part.trim();
        if (!trimmed) return cookies;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return cookies;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function setMonitoringSessionCookie(req, res, token) {
    const cookieParts = [
        `${MONITORING_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/',
        `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
        'HttpOnly',
        'SameSite=Lax'
    ];

    if (isSecureRequest(req)) {
        cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearMonitoringSessionCookie(req, res) {
    const cookieParts = [
        `${MONITORING_SESSION_COOKIE}=`,
        'Path=/',
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'HttpOnly',
        'SameSite=Lax'
    ];

    if (isSecureRequest(req)) {
        cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function hasGlobalMonitoringAccess(user) {
    return !!user && (user.role === 'admin' || user.role === 'super_admin');
}

function getMonitoringSessionFromRequest(req) {
    const cookies = parseCookies(req);
    const token = cookies[MONITORING_SESSION_COOKIE];

    if (!token || !monitoringSessions.has(token)) {
        return null;
    }

    const session = monitoringSessions.get(token);
    if (!session || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
        monitoringSessions.delete(token);
        return null;
    }

    return { token, session };
}

function authenticateMonitoring(req, res, next) {
    const sessionInfo = getMonitoringSessionFromRequest(req);
    if (!sessionInfo) {
        return res.status(401).json({ message: 'Monitoring session is invalid' });
    }

    req.monitoringUser = sessionInfo.session.user;
    req.monitoringSessionToken = sessionInfo.token;
    next();
}

function monitoringPageAuth(req, res, next) {
    const pathName = req.path || '/';
    const allowedWithoutMonitoringLogin = new Set([
        '/monitoring-login.html',
        '/admin-login.html',
        '/admin.html'
    ]);

    if (allowedWithoutMonitoringLogin.has(pathName)) {
        if (pathName === '/monitoring-login.html' && getMonitoringSessionFromRequest(req)) {
            return res.redirect('/monitoring/index.html');
        }
        return next();
    }

    const protectedPages = new Set(['/', '/index.html', '/stats.html', '/report.html', '/about.html', '/contact.html']);
    if (!protectedPages.has(pathName)) {
        return next();
    }

    const sessionInfo = getMonitoringSessionFromRequest(req);
    if (!sessionInfo) {
        return res.redirect('/monitoring/monitoring-login.html');
    }

    req.monitoringUser = sessionInfo.session.user;
    next();
}

app.use('/monitoring', monitoringPageAuth, express.static(path.join(__dirname, '../public')));

async function getCountryRows() {
    return db.query("SELECT id, name, country_code FROM country ORDER BY name");
}

function buildCountryMatchers(rows) {
    const matchers = [];
    const seenKeys = new Set();

    rows.forEach((row) => {
        [row.name, row.country_code].forEach((rawKey) => {
            const key = String(rawKey || '').trim().toLowerCase();
            if (!key || seenKeys.has(key)) return;

            seenKeys.add(key);
            matchers.push({
                key,
                name: row.name,
                countryCode: row.country_code
            });
        });
    });

    matchers.sort((a, b) => b.key.length - a.key.length);
    return matchers;
}

function extractCountryFromSummary(summary, countryMatchers) {
    const summaryText = String(summary || '').toLowerCase();
    for (const matcher of countryMatchers) {
        if (summaryText.includes(matcher.key)) {
            return matcher.name;
        }
    }
    return null;
}

async function readIssuesData() {
    const filePath = path.join(__dirname, '../issues.json');
    const data = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(data);
}

function filterIssuesForMonitoringUser(issues, monitoringUser, countryMatchers) {
    if (!monitoringUser || hasGlobalMonitoringAccess(monitoringUser) || !monitoringUser.accessCountryName) {
        return issues;
    }

    const allowedCountry = String(monitoringUser.accessCountryName).toLowerCase();
    return issues.filter((issue) => {
        const issueCountry = extractCountryFromSummary(issue.summary, countryMatchers);
        return issueCountry && issueCountry.toLowerCase() === allowedCountry;
    });
}

function filterCountryRowsForMonitoringUser(rows, monitoringUser) {
    if (!monitoringUser || hasGlobalMonitoringAccess(monitoringUser) || !monitoringUser.accessCountryName) {
        return rows;
    }

    const allowedCountryName = String(monitoringUser.accessCountryName).toLowerCase();
    const allowedCountryCode = String(monitoringUser.accessCountryCode || '').toLowerCase();

    return rows.filter((row) => {
        const rowName = String(row.name || '').toLowerCase();
        const rowCode = String(row.country_code || '').toLowerCase();
        return rowName === allowedCountryName || (allowedCountryCode && rowCode === allowedCountryCode);
    });
}

async function initializeMonitoringUsers() {
    const slugifyEmailSegment = (value) => {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    };

    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS monitoring_user (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(191) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('super_admin', 'admin', 'user') NOT NULL,
            display_name VARCHAR(191) NOT NULL,
            access_country_name VARCHAR(191) NULL,
            access_country_code VARCHAR(100) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    await db.execute(createTableSQL);
    await db.execute(`ALTER TABLE monitoring_user MODIFY role ENUM('super_admin', 'admin', 'user') NOT NULL`);
    await db.execute(`ALTER TABLE monitoring_user MODIFY access_country_name VARCHAR(191) NULL`);
    await db.execute(`ALTER TABLE monitoring_user MODIFY access_country_code VARCHAR(100) NULL`);

    for (const privilegedUser of MONITORING_PRIVILEGED_SEEDS) {
        await db.execute(
            `INSERT INTO monitoring_user (email, password_hash, role, display_name, access_country_name, access_country_code, is_active)
             VALUES (?, ?, ?, ?, NULL, NULL, 1)
             ON DUPLICATE KEY UPDATE
                role = VALUES(role),
                display_name = VALUES(display_name),
                access_country_name = VALUES(access_country_name),
                access_country_code = VALUES(access_country_code),
                is_active = 1`,
            [privilegedUser.email, createPasswordHash(DEFAULT_MONITORING_PASSWORD), privilegedUser.role, privilegedUser.displayName]
        );
    }

    const countries = await getCountryRows();
    for (const country of countries) {
        const emailSegment = slugifyEmailSegment(country.name || country.country_code);
        if (!emailSegment) continue;

        const email = `nfp.${emailSegment}@rwc.local`;
        const displayName = `NFP WDQMS ${country.name}`;
        const existingUsers = await db.query(
            `SELECT id FROM monitoring_user
             WHERE role = 'user' AND access_country_name = ?
             LIMIT 1`,
            [country.name]
        );
        if (existingUsers.length > 0) {
            continue;
        }

        await db.execute(
            `INSERT INTO monitoring_user (email, password_hash, role, display_name, access_country_name, access_country_code, is_active)
             VALUES (?, ?, 'user', ?, ?, ?, 1)`,
            [email, createPasswordHash(DEFAULT_MONITORING_PASSWORD), displayName, country.name, country.country_code]
        );
    }
}

// Middleware untuk autentikasi admin
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token tidak ditemukan' });
    }

    const token = authHeader.substring(7);

    if (!sessions.has(token)) {
        return res.status(401).json({ message: 'Token tidak valid' });
    }

    const session = sessions.get(token);

    // Check if session is expired (24 hours)
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(token);
        return res.status(401).json({ message: 'Session expired' });
    }

    req.admin = session.user;
    next();
}

function requireSuperAdmin(req, res, next) {
    if (!req.admin || req.admin.role !== 'super_admin') {
        return res.status(403).json({ message: 'Akses hanya untuk super admin' });
    }

    next();
}

function mapMonitoringUserRow(row) {
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        displayName: row.display_name,
        accessCountryName: row.access_country_name,
        accessCountryCode: row.access_country_code,
        isActive: !!row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function buildMonitoringUserDefaults({ role, displayName, accessCountryName, accessCountryCode }) {
    const normalizedRole = ['super_admin', 'admin', 'user'].includes(role) ? role : 'user';
    const normalizedCountryName = accessCountryName ? String(accessCountryName).trim() : null;
    const normalizedCountryCode = accessCountryCode ? String(accessCountryCode).trim() : null;

    let resolvedDisplayName = String(displayName || '').trim();
    if (!resolvedDisplayName) {
        if (normalizedRole === 'user' && normalizedCountryName) {
            resolvedDisplayName = `NFP WDQMS ${normalizedCountryName}`;
        } else if (normalizedRole === 'super_admin') {
            resolvedDisplayName = 'Super Admin';
        } else if (normalizedRole === 'admin') {
            resolvedDisplayName = 'Admin User';
        }
    }

    return {
        role: normalizedRole,
        displayName: resolvedDisplayName,
        accessCountryName: normalizedRole === 'user' ? normalizedCountryName : null,
        accessCountryCode: normalizedRole === 'user' ? normalizedCountryCode : null
    };
}

async function countMonitoringUsersByRole(role) {
    const rows = await db.query(
        `SELECT COUNT(*) AS total FROM monitoring_user WHERE role = ? AND is_active = 1`,
        [role]
    );
    return Number(rows[0]?.total || 0);
}

// Login endpoint
app.post('/api/admin/login', async (req, res) => {
    const identifier = String(req.body?.username || req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
        return res.status(400).json({ message: 'Email dan password diperlukan' });
    }

    try {
        const rows = await db.query(
            `SELECT id, email, password_hash, role, display_name, access_country_name, access_country_code, is_active
             FROM monitoring_user
             WHERE LOWER(email) = ?
               AND role IN ('super_admin', 'admin')
             LIMIT 1`,
            [identifier]
        );

        if (!rows.length || !rows[0].is_active || !verifyPassword(password, rows[0].password_hash)) {
            return res.status(401).json({ message: 'Email or password is incorrect' });
        }

        const token = generateToken();
        const user = mapMonitoringUserRow(rows[0]);
        sessions.set(token, {
            user,
            createdAt: Date.now()
        });

        res.json({
            message: 'Login berhasil',
            token,
            user
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: 'Gagal melakukan login admin' });
    }
});

// Verify token endpoint
app.get('/api/admin/verify', authenticateAdmin, (req, res) => {
    res.json({
        message: 'Token valid',
        user: req.admin
    });
});

// Disable legacy public log page route
app.get('/log', (req, res) => {
    res.status(404).send('Not Found');
});

// Clean URLs for Activities landing pages.
// CARA TAMBAH TRAINING/WORKSHOP BARU: copy file detail
// landingpage/training-<slug>.html lalu daftarkan slug di bawah.
const capacityTrainingPages = {
    'im-metadata-wigos-tools': 'training-im-metadata-wigos-tools.html',
};
app.get('/activities', (req, res) => {
    res.sendFile(path.join(__dirname, '../../landingpage/activities.html'));
});
app.get('/activities/capacity-development', (req, res) => {
    res.sendFile(path.join(__dirname, '../../landingpage/capacity-development.html'));
});
app.get('/activities/coordination-meeting', (req, res) => {
    res.sendFile(path.join(__dirname, '../../landingpage/coordination-meeting.html'));
});
app.get('/activities/capacity-development/:slug', (req, res) => {
    const file = capacityTrainingPages[req.params.slug];
    if (!file) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, '../../landingpage', file));
});

// Backward compat: redirect URL lama ke struktur Activities baru.
app.get('/capacity-development', (req, res) => res.redirect(301, '/activities/capacity-development'));
app.get('/capacity-development/:slug', (req, res) => res.redirect(301, '/activities/capacity-development/' + req.params.slug));


// Reports — list UI, monthly/yearly PDF downloads (multi-language: EN / ID), HTML detail for yearly.
//
// STRUKTUR FOLDER PDF (statis, di-serve via /assets/REPORT/...):
//   landingpage/assets/REPORT/<year>/<LANG>/<mm>-<monthname>.pdf   (bulanan)
//   landingpage/assets/REPORT/<year>/<LANG>/13-yearly.pdf          (tahunan)
//   LANG = EN | ID
//
// STRUKTUR DATA:
//   reportYears[year] = {
//     months: { '01': { EN?: filename, ID?: filename }, ... },
//     yearly: { html: 'report-YYYY-yearly.html'|null, pdf: { EN?: '13-yearly.pdf', ID?: '13-yearly.pdf' } }
//   }
//   Key bulan yg tidak ada / null akan di-skip.
//
// CARA TAMBAH LAPORAN:
//   A. Tahun baru YYYY: buat folder landingpage/assets/REPORT/YYYY/EN (dan ID bila ada),
//      simpan PDF bulanan & 13-yearly.pdf, lalu tambah entry di reportYears.
//   B. Menambah versi bahasa: taruh PDF di folder LANG terkait & tambahkan key di map bulan.
const MONTH_PDF_FILES = {
    '01': { EN: '01-january.pdf', ID: '01-january.pdf' },
    '02': { EN: '02-february.pdf', ID: '02-february.pdf' },
    '03': { EN: '03-march.pdf', ID: '03-march.pdf' },
    '04': { EN: '04-april.pdf', ID: '04-april.pdf' },
    '05': { EN: '05-may.pdf', ID: '05-may.pdf' },
    '06': { EN: '06-june.pdf', ID: '06-june.pdf' },
    '07': { EN: '07-july.pdf', ID: '07-july.pdf' },
    '08': { EN: '08-august.pdf', ID: '08-august.pdf' },
    '09': { EN: '09-september.pdf', ID: '09-september.pdf' },
    '10': { EN: '10-october.pdf', ID: '10-october.pdf' },
    '11': { EN: '11-november.pdf', ID: '11-november.pdf' },
    '12': { EN: '12-december.pdf', ID: '12-december.pdf' },
};

// Helper: ambil hanya bahasa yg benar-benar tersedia (EN-only utk tahun tanpa versi ID).
const enOnly = mm => ({ EN: MONTH_PDF_FILES[mm].EN });

const reportYears = {
    '2024': {
        months: Object.assign({}, MONTH_PDF_FILES), // EN + ID lengkap
        yearly: { html: 'report-2024-yearly.html', pdf: { EN: '13-yearly.pdf' } },
    },
    '2025': {
        months: Object.assign({}, MONTH_PDF_FILES), // EN + ID lengkap
        yearly: { html: 'report-2025-yearly.html', pdf: { EN: '13-yearly.pdf' } },
    },
    '2026': {
        // EN tersedia untuk Jan-Agustus; versi ID menyusul untuk Mar & Jun.
        months: {
            '01': { EN: '01-january.pdf', ID: '01-january.pdf' },
            '02': { EN: '02-february.pdf', ID: '02-february.pdf' },
            '03': enOnly('03'),
            '04': { EN: '04-april.pdf', ID: '04-april.pdf' },
            '05': { EN: '05-may.pdf', ID: '05-may.pdf' },
            '06': enOnly('06'),
            '07': { EN: '07-july.pdf', ID: '07-july.pdf' },
            '08': { EN: '08-august.pdf', ID: '08-august.pdf' },
        },
        yearly: null,
    },
};

// Index endpoint — dipakai reports.html untuk render daftar tahun & bulan.
app.get('/api/reports/index', (req, res) => {
    const years = Object.keys(reportYears).sort().reverse();
    res.json({
        years: years.map(y => {
            const entry = reportYears[y] || {};
            const monthsObj = entry.months || {};
            // months: { '01': ['EN','ID'], ... } — hanya bulan yang punya minimal 1 bahasa
            const months = {};
            Object.keys(monthsObj).forEach(mm => {
                const langs = monthsObj[mm];
                if (!langs) return;
                const available = (typeof langs === 'string')
                    ? ['EN']  // kompatibilitas data lama
                    : Object.keys(langs).filter(l => langs[l]);
                if (available.length) months[mm] = available;
            });
            const yearlyPdfLangs = entry.yearly && entry.yearly.pdf
                ? (typeof entry.yearly.pdf === 'string'
                    ? ['EN']
                    : Object.keys(entry.yearly.pdf).filter(l => entry.yearly.pdf[l]))
                : [];
            return {
                year: y,
                months: months,
                hasYearly: Boolean(entry.yearly && entry.yearly.html),
                yearlyPdfLangs: yearlyPdfLangs,
            };
        }),
    });
});

app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, '../../landingpage/reports.html'));
});

// Yearly HTML page: /reports/2024/yearly
app.get('/reports/:year/yearly', (req, res) => {
    const entry = reportYears[req.params.year];
    if (!entry || !entry.yearly || !entry.yearly.html) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, '../../landingpage', entry.yearly.html));
});

// Quell Chrome DevTools probe request and common favicon 404 noise
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ status: 'ok' }));
});

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Logout endpoint
app.post('/api/admin/logout', (req, res) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        sessions.delete(token);
    }

    res.json({ message: 'Logout berhasil' });
});

app.post('/api/monitoring/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
        return res.status(400).json({ message: 'Email dan password diperlukan' });
    }

    try {
        const rows = await db.query(
            `SELECT id, email, password_hash, role, display_name, access_country_name, access_country_code, is_active
             FROM monitoring_user
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        if (!rows.length || !rows[0].is_active || !verifyPassword(password, rows[0].password_hash)) {
            return res.status(401).json({ message: 'Email atau password salah' });
        }

        const user = mapMonitoringUserRow(rows[0]);

        const token = generateToken();
        monitoringSessions.set(token, {
            user,
            createdAt: Date.now()
        });

        setMonitoringSessionCookie(req, res, token);
        res.json({
            message: 'Monitoring login successful',
            user
        });
    } catch (error) {
        console.error('Monitoring login error:', error);
        res.status(500).json({ message: 'Failed to log in to monitoring' });
    }
});

app.get('/api/monitoring/session', authenticateMonitoring, (req, res) => {
    res.json({
        user: req.monitoringUser
    });
});

app.post('/api/monitoring/change-password', authenticateMonitoring, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }

    if (currentPassword === newPassword) {
        return res.status(400).json({ message: 'New password must be different from the current password' });
    }

    try {
        const rows = await db.query(
            `SELECT id, email, password_hash, role, display_name, access_country_name, access_country_code, is_active
             FROM monitoring_user
             WHERE id = ?
             LIMIT 1`,
            [req.monitoringUser.id]
        );

        if (!rows.length || !rows[0].is_active) {
            monitoringSessions.delete(req.monitoringSessionToken);
            clearMonitoringSessionCookie(req, res);
            return res.status(401).json({ message: 'Monitoring user is inactive or was not found' });
        }

        if (!verifyPassword(currentPassword, rows[0].password_hash)) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        await db.execute(
            `UPDATE monitoring_user
             SET password_hash = ?
             WHERE id = ?`,
            [createPasswordHash(newPassword), req.monitoringUser.id]
        );

        const user = mapMonitoringUserRow(rows[0]);
        monitoringSessions.forEach((session, token) => {
            if (session?.user?.id === user.id && token !== req.monitoringSessionToken) {
                monitoringSessions.delete(token);
            }
        });

        monitoringSessions.set(req.monitoringSessionToken, {
            user,
            createdAt: Date.now()
        });

        res.json({
            message: 'Password updated successfully',
            user
        });
    } catch (error) {
        console.error('Monitoring change password error:', error);
        res.status(500).json({ message: 'Failed to update password' });
    }
});

app.post('/api/monitoring/logout', (req, res) => {
    const sessionInfo = getMonitoringSessionFromRequest(req);
    if (sessionInfo) {
        monitoringSessions.delete(sessionInfo.token);
    }

    clearMonitoringSessionCookie(req, res);
    res.json({ message: 'Monitoring logout successful' });
});

// Endpoint untuk ambil data JSON
app.get('/api/issues', authenticateMonitoring, async (req, res) => {
    try {
        const countryRows = await getCountryRows();
        const countryMatchers = buildCountryMatchers(countryRows);
        const issues = await readIssuesData();
        const filteredIssues = filterIssuesForMonitoringUser(issues, req.monitoringUser, countryMatchers);
        res.json(filteredIssues);
    } catch (error) {
        console.error("Error reading issues.json:", error);
        res.status(500).json({ error: "Gagal baca file" });
    }
});

app.get('/api/summary', authenticateMonitoring, async (req, res) => {
    try {
        const countryRows = await getCountryRows();
        const countryMatchers = buildCountryMatchers(countryRows);
        const issues = await readIssuesData();
        const filteredIssues = filterIssuesForMonitoringUser(issues, req.monitoringUser, countryMatchers);
        const total = filteredIssues.length;
        const closed = filteredIssues.filter(i => {
            const status = (i.status || '').toLowerCase().trim();
            return status === 'closed';
        }).length;
        const backlog = total - closed;
        res.json({ total, closed, backlog });
    } catch (error) {
        console.error("Error building summary:", error);
        res.status(500).json({ error: "Gagal baca file" });
    }
});

// === WDQMS SUMMARY (from WDQMS v2 API) ===
// Landing page memakai ringkasan kualitas per platform. Data diambil dari
// FastAPI wdqms-v2, lalu di-cache singkat agar tidak membanjiri API.
const WDQMS_V2_TIMEOUT_MS = parseInt(process.env.WDQMS_V2_TIMEOUT_MS || '10000', 10) || 10000;
const WDQMS_SUMMARY_TTL_MS = parseInt(process.env.WDQMS_SUMMARY_TTL_MS || '300000', 10) || 300000;
const WDQMS_SUMMARY_LOOKBACK_DAYS = Math.max(0, parseInt(process.env.WDQMS_SUMMARY_LOOKBACK_DAYS || '14', 10) || 0);
const WDQMS_SUMMARY_CACHE_FILE = path.join(__dirname, '../cache/wdqms-summary.json');

let cachedWdqmsSummary = null;
let lastWdqmsSummaryFetch = 0;

function wdqmsDateString(daysAgo) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchWdqmsJson(pathname, params) {
    const url = new URL(WDQMS_V2_API_URL + pathname);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WDQMS_V2_TIMEOUT_MS);
    try {
        const response = await fetch(url.toString(), {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function averageWdqmsAvailability(stations) {
    let total = 0;
    let count = 0;

    for (const station of stations || []) {
        let pct = Number(station.availability_pct);
        if (!Number.isFinite(pct) && station.centers && typeof station.centers === 'object') {
            let best = null;
            for (const center of Object.values(station.centers)) {
                const value = Number(center && center.availability_pct);
                if (Number.isFinite(value) && (best === null || value > best)) {
                    best = value;
                }
            }
            pct = best;
        }
        if (Number.isFinite(pct)) {
            // received > expected (more_than_declared) bisa menghasilkan >100%.
            total += Math.min(Math.max(pct, 0), 100);
            count += 1;
        }
    }

    return count > 0 ? Number((total / count).toFixed(1)) : 0;
}

function addWdqmsStatusCounts(target, summary) {
    if (!summary) return;
    target.operational += Number(summary.complete || 0) + Number(summary.more_than_declared || 0);
    target.issues += Number(summary.issues_low || 0);
    target.critical += Number(summary.issues_high || 0);
    target.notReceived += Number(summary.not_received || 0) + Number(summary.no_data || 0);
}

const WDQMS_PLATFORM_QUERIES = [
    { key: 'gbonSurface', path: '/api/v1/observations/gbon/land-surface', params: { variable: 'pressure' } },
    { key: 'gbonUpperAir', path: '/api/v1/observations/gbon/upper-air', params: { variable: 'temperature' } },
    { key: 'nwpSurface', path: '/api/v1/observations/nwp/land-surface', params: { variable: 'pressure', monitoring_category: 'availability', baseline: 'OSCAR', centers: 'DWD,ECMWF,JMA,NCEP' } },
    { key: 'nwpUpperAir', path: '/api/v1/observations/nwp/upper-air', params: { variable: 'temperature', monitoring_category: 'availability', baseline: 'OSCAR', centers: 'DWD,ECMWF,JMA,NCEP' } }
];

function wdqmsHasData(payload) {
    const stations = payload && Array.isArray(payload.stations) ? payload.stations : [];
    const noData = Number((payload && payload.summary && payload.summary.no_data) || 0);
    return stations.length > 0 && stations.length - noData > 0;
}

async function fetchLatestPlatformPayload(platform) {
    let fallback = null;

    for (let offset = 2; offset <= 2 + WDQMS_SUMMARY_LOOKBACK_DAYS; offset += 1) {
        const date = wdqmsDateString(offset);
        const params = Object.assign({ territory: 'ALL_COMBINED', date, period: 'daily' }, platform.params);
        try {
            const payload = await fetchWdqmsJson(platform.path, params);
            if (!payload) continue;
            if (wdqmsHasData(payload)) {
                return { payload, date };
            }
            if (!fallback && Array.isArray(payload.stations) && payload.stations.length > 0) {
                fallback = { payload, date };
            }
        } catch (error) {
            // Tanggal ini gagal; coba tanggal berikutnya.
        }
    }

    return fallback;
}

async function buildWdqmsSummaryFromV2() {
    // Cek backend v2 dulu supaya kegagalan koneksi tidak diulang per platform.
    await fetchWdqmsJson('/healthz', {});

    const results = await Promise.all(WDQMS_PLATFORM_QUERIES.map((platform) => fetchLatestPlatformPayload(platform)));

    const payloads = {};
    const dates = {};
    WDQMS_PLATFORM_QUERIES.forEach((platform, index) => {
        const result = results[index];
        payloads[platform.key] = result ? result.payload : null;
        dates[platform.key] = result ? result.date : null;
    });

    const gbonSurface = payloads.gbonSurface;
    const gbonUpperAir = payloads.gbonUpperAir;
    const nwpSurface = payloads.nwpSurface;
    const nwpUpperAir = payloads.nwpUpperAir;

    const stationCounts = {
        gbonSurfaceLand: gbonSurface && gbonSurface.stations ? gbonSurface.stations.length : 0,
        gbonUpperAir: gbonUpperAir && gbonUpperAir.stations ? gbonUpperAir.stations.length : 0,
        nwpSurfaceLand: nwpSurface && nwpSurface.stations ? nwpSurface.stations.length : 0,
        nwpUpperAir: nwpUpperAir && nwpUpperAir.stations ? nwpUpperAir.stations.length : 0
    };

    const statusCounts = { operational: 0, issues: 0, critical: 0, notReceived: 0 };
    Object.values(payloads).forEach((payload) => addWdqmsStatusCounts(statusCounts, payload && payload.summary));

    const uniqueStations = new Set();
    Object.values(payloads).forEach((payload) => {
        (payload && payload.stations ? payload.stations : []).forEach((station) => {
            const id = station.wigos_id || station.wigosId || station.id;
            if (id) uniqueStations.add(id);
        });
    });

    const dataQualityGBONSurfaceLand = averageWdqmsAvailability(gbonSurface && gbonSurface.stations);
    const dataQualityGBONUpperAir = averageWdqmsAvailability(gbonUpperAir && gbonUpperAir.stations);
    const dataQualityNWPSurfaceLand = averageWdqmsAvailability(nwpSurface && nwpSurface.stations);
    const dataQualityNWPUpperAir = averageWdqmsAvailability(nwpUpperAir && nwpUpperAir.stations);

    return {
        source: 'wdqms-v2',
        date: dates.gbonSurface || wdqmsDateString(2),
        dates,
        totalStations: uniqueStations.size,
        dataQualityGBON: Number(((dataQualityGBONSurfaceLand + dataQualityGBONUpperAir) / 2).toFixed(1)),
        dataQualityNWP: Number(((dataQualityNWPSurfaceLand + dataQualityNWPUpperAir) / 2).toFixed(1)),
        dataQualityGBONSurfaceLand,
        dataQualityGBONUpperAir,
        dataQualityNWPSurfaceLand,
        dataQualityNWPUpperAir,
        stationCounts,
        operational: statusCounts.operational,
        issues: statusCounts.issues,
        critical: statusCounts.critical,
        notReceived: statusCounts.notReceived,
        generatedAt: new Date().toISOString()
    };
}

app.get('/api/wdqms-summary', async (req, res) => {
    if (cachedWdqmsSummary && Date.now() - lastWdqmsSummaryFetch < WDQMS_SUMMARY_TTL_MS) {
        return res.json(cachedWdqmsSummary);
    }

    try {
        const summary = await buildWdqmsSummaryFromV2();
        cachedWdqmsSummary = summary;
        lastWdqmsSummaryFetch = Date.now();

        try {
            await fs.promises.mkdir(path.dirname(WDQMS_SUMMARY_CACHE_FILE), { recursive: true });
            await fs.promises.writeFile(WDQMS_SUMMARY_CACHE_FILE, JSON.stringify(summary), 'utf8');
        } catch (cacheError) {
            // Cache disk bersifat best-effort.
        }

        return res.json(summary);
    } catch (error) {
        console.warn('WDQMS v2 summary unavailable:', error.message);

        try {
            const raw = await fs.promises.readFile(WDQMS_SUMMARY_CACHE_FILE, 'utf8');
            const cached = JSON.parse(raw);
            cachedWdqmsSummary = cached;
            // Coba lagi setelah 1 menit, jangan tunggu TTL penuh.
            lastWdqmsSummaryFetch = Date.now() - WDQMS_SUMMARY_TTL_MS + 60000;
            return res.json(Object.assign({}, cached, { cached: true, stale: true }));
        } catch (cacheError) {
            return res.json({
                available: false,
                source: 'wdqms-v2',
                message: 'WDQMS v2 API belum tersedia'
            });
        }
    }
});

// Endpoint untuk waktu pembaruan terakhir
app.get('/api/last-updated', authenticateMonitoring, (req, res) => {
    fs.stat(path.join(__dirname, '../issues.json'), (err, stats) => {
        if (err) return res.status(500).json({ error: "File tidak ditemukan" });
        res.json({
            lastUpdated: new Date(stats.mtime).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
        });
    });
});

// === LOGS API ENDPOINTS ===
// GET logs/scrape.log (last N lines)
app.get('/api/logs/scrape', async (req, res) => {
    const linesParam = parseInt(req.query.lines, 10);
    const maxLines = Number.isFinite(linesParam) && linesParam > 0 ? Math.min(linesParam, 5000) : 1000;
    const logPath = path.join(__dirname, '../logs/scrape.log');

    try {
        const content = await fs.promises.readFile(logPath, 'utf8');
        const allLines = content.split(/\r?\n/);
        const result = allLines.slice(-maxLines);
        res.json({
            totalLines: allLines.length,
            returnedLines: result.length,
            lines: result
        });
    } catch (err) {
        console.error('Error reading scrape.log:', err);
        res.status(500).json({ error: 'Gagal membaca log', message: err.message });
    }
});

// === PUBLIC API ENDPOINTS ===

// GET semua countries (public endpoint untuk filter)
app.get('/api/countries', authenticateMonitoring, async (req, res) => {
    try {
        const rows = await getCountryRows();
        res.json(filterCountryRowsForMonitoringUser(rows, req.monitoringUser));
    } catch (err) {
        console.error("Error fetching countries:", err);
        res.status(500).json({ error: err.message });
    }
});

// === ADMIN API ENDPOINTS ===

app.get('/api/admin/monitoring-users', authenticateAdmin, requireSuperAdmin, async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT id, email, role, display_name, access_country_name, access_country_code, is_active, created_at, updated_at
             FROM monitoring_user
             ORDER BY FIELD(role, 'super_admin', 'admin', 'user'), display_name ASC, email ASC`
        );
        res.json(rows.map(mapMonitoringUserRow));
    } catch (error) {
        console.error('Error fetching monitoring users:', error);
        res.status(500).json({ message: 'Gagal mengambil data user monitoring' });
    }
});

app.post('/api/admin/monitoring-users', authenticateAdmin, requireSuperAdmin, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const isActive = req.body?.isActive !== false;
    const defaults = buildMonitoringUserDefaults({
        role: req.body?.role,
        displayName: req.body?.displayName,
        accessCountryName: req.body?.accessCountryName,
        accessCountryCode: req.body?.accessCountryCode
    });

    if (!email || !password) {
        return res.status(400).json({ message: 'Email dan password wajib diisi' });
    }

    if (!defaults.displayName) {
        return res.status(400).json({ message: 'Display name wajib diisi' });
    }

    if (defaults.role === 'user' && !defaults.accessCountryName) {
        return res.status(400).json({ message: 'Country wajib dipilih untuk user biasa' });
    }

    try {
        const result = await db.execute(
            `INSERT INTO monitoring_user (email, password_hash, role, display_name, access_country_name, access_country_code, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                createPasswordHash(password),
                defaults.role,
                defaults.displayName,
                defaults.accessCountryName,
                defaults.accessCountryCode,
                isActive ? 1 : 0
            ]
        );

        const rows = await db.query(
            `SELECT id, email, role, display_name, access_country_name, access_country_code, is_active, created_at, updated_at
             FROM monitoring_user
             WHERE id = ?
             LIMIT 1`,
            [result.insertId]
        );

        res.json({
            message: 'User monitoring berhasil dibuat',
            user: mapMonitoringUserRow(rows[0])
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email sudah digunakan' });
        }
        console.error('Error creating monitoring user:', error);
        res.status(500).json({ message: 'Gagal membuat user monitoring' });
    }
});

app.put('/api/admin/monitoring-users/:id', authenticateAdmin, requireSuperAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const isActive = req.body?.isActive !== false;
    const defaults = buildMonitoringUserDefaults({
        role: req.body?.role,
        displayName: req.body?.displayName,
        accessCountryName: req.body?.accessCountryName,
        accessCountryCode: req.body?.accessCountryCode
    });

    if (!userId || !email) {
        return res.status(400).json({ message: 'ID user dan email wajib diisi' });
    }

    if (!defaults.displayName) {
        return res.status(400).json({ message: 'Display name wajib diisi' });
    }

    if (defaults.role === 'user' && !defaults.accessCountryName) {
        return res.status(400).json({ message: 'Country wajib dipilih untuk user biasa' });
    }

    try {
        const existingRows = await db.query(
            `SELECT id, role, email FROM monitoring_user WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!existingRows.length) {
            return res.status(404).json({ message: 'User monitoring tidak ditemukan' });
        }

        if (existingRows[0].role === 'super_admin' && defaults.role !== 'super_admin') {
            const totalSuperAdmins = await countMonitoringUsersByRole('super_admin');
            if (totalSuperAdmins <= 1) {
                return res.status(400).json({ message: 'Minimal harus ada satu super admin aktif' });
            }
        }

        if (existingRows[0].role === 'super_admin' && !isActive) {
            const totalSuperAdmins = await countMonitoringUsersByRole('super_admin');
            if (totalSuperAdmins <= 1) {
                return res.status(400).json({ message: 'Super admin terakhir tidak boleh dinonaktifkan' });
            }
        }

        if (password) {
            await db.execute(
                `UPDATE monitoring_user
                 SET email = ?, password_hash = ?, role = ?, display_name = ?, access_country_name = ?, access_country_code = ?, is_active = ?
                 WHERE id = ?`,
                [
                    email,
                    createPasswordHash(password),
                    defaults.role,
                    defaults.displayName,
                    defaults.accessCountryName,
                    defaults.accessCountryCode,
                    isActive ? 1 : 0,
                    userId
                ]
            );
        } else {
            await db.execute(
                `UPDATE monitoring_user
                 SET email = ?, role = ?, display_name = ?, access_country_name = ?, access_country_code = ?, is_active = ?
                 WHERE id = ?`,
                [
                    email,
                    defaults.role,
                    defaults.displayName,
                    defaults.accessCountryName,
                    defaults.accessCountryCode,
                    isActive ? 1 : 0,
                    userId
                ]
            );
        }

        const rows = await db.query(
            `SELECT id, email, role, display_name, access_country_name, access_country_code, is_active, created_at, updated_at
             FROM monitoring_user
             WHERE id = ?
             LIMIT 1`,
            [userId]
        );

        res.json({
            message: 'User monitoring berhasil diperbarui',
            user: mapMonitoringUserRow(rows[0])
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email sudah digunakan' });
        }
        console.error('Error updating monitoring user:', error);
        res.status(500).json({ message: 'Gagal memperbarui user monitoring' });
    }
});

app.delete('/api/admin/monitoring-users/:id', authenticateAdmin, requireSuperAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) {
        return res.status(400).json({ message: 'ID user tidak valid' });
    }

    try {
        const rows = await db.query(
            `SELECT id, role FROM monitoring_user WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!rows.length) {
            return res.status(404).json({ message: 'User monitoring tidak ditemukan' });
        }

        if (rows[0].role === 'super_admin') {
            const totalSuperAdmins = await countMonitoringUsersByRole('super_admin');
            if (totalSuperAdmins <= 1) {
                return res.status(400).json({ message: 'Super admin terakhir tidak boleh dihapus' });
            }
        }

        await db.execute(`DELETE FROM monitoring_user WHERE id = ?`, [userId]);
        res.json({ message: 'User monitoring berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting monitoring user:', error);
        res.status(500).json({ message: 'Gagal menghapus user monitoring' });
    }
});

// GET semua countries (admin endpoint)
app.get('/api/admin/countries', authenticateAdmin, async (req, res) => {
    try {
        const rows = await db.query("SELECT * FROM country ORDER BY name");
        res.json(rows);
    } catch (err) {
        console.error("Error fetching countries:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST tambah country baru
app.post('/api/admin/countries', authenticateAdmin, async (req, res) => {
    const { name, country_code } = req.body;

    if (!name || !country_code) {
        return res.status(400).json({ error: 'Name and country_code are required' });
    }

    try {
        const result = await db.execute("INSERT INTO country (name, country_code) VALUES (?, ?)", [name, country_code]);
        res.json({ id: result.insertId, name, country_code });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Country code already exists' });
        }
        console.error("Error inserting country:", err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE country
app.delete('/api/admin/countries/:id', authenticateAdmin, async (req, res) => {
    const id = req.params.id;

    try {
        const result = await db.execute("DELETE FROM country WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Country not found' });
        }
        res.json({ message: 'Country deleted successfully' });
    } catch (err) {
        console.error("Error deleting country:", err);
        res.status(500).json({ error: err.message });
    }
});

// Test endpoint for debugging
app.get('/api/admin/test', authenticateAdmin, (req, res) => {
    res.json({ message: 'Admin routes are working' });
});

// GET list available charts for a month/year
app.get('/api/admin/charts/:bulan/:tahun', authenticateAdmin, async (req, res) => {
    const { bulan, tahun } = req.params;
    if (!bulan || !tahun) {
        return res.status(400).json({ error: 'Bulan dan tahun diperlukan' });
    }

    try {
        const chartDir = path.join(__dirname, '..', 'charts');
        const chartTypes = ['Status_Vertical', 'Status_Horizontal', 'Status_Pie', 'StatusAll_Vertical', 'StatusAll_Horizontal', 'StatusAll_Pie', 'Country', 'CountryStatus', 'Category'];
        const availableCharts = [];

        for (const type of chartTypes) {
            const fileName = `Laporan_Chart_${type}_${bulan}_${tahun}.png`;
            const filePath = path.join(chartDir, fileName);
            try {
                await fs.promises.access(filePath);
                availableCharts.push({ type, fileName });
            } catch (err) {
                // File doesn't exist, skip
            }
        }

        res.json({ charts: availableCharts, bulan, tahun });
    } catch (err) {
        console.error('Error listing charts:', err);
        res.status(500).json({ error: 'Gagal mendapatkan daftar chart' });
    }
});

// GET download all charts as ZIP
app.get('/api/admin/download-all-charts/:bulan/:tahun', authenticateAdmin, async (req, res) => {
    const { bulan, tahun } = req.params;
    if (!bulan || !tahun) {
        return res.status(400).json({ error: 'Bulan dan tahun diperlukan' });
    }

    try {
        const chartDir = path.join(__dirname, '..', 'charts');
        const chartTypes = ['Status_Vertical', 'Status_Horizontal', 'Status_Pie', 'StatusAll_Vertical', 'StatusAll_Horizontal', 'StatusAll_Pie', 'Country', 'CountryStatus', 'Category'];
        const zip = new AdmZip();
        let addedCount = 0;

        for (const type of chartTypes) {
            const fileName = `Laporan_Chart_${type}_${bulan}_${tahun}.png`;
            const filePath = path.join(chartDir, fileName);
            try {
                await fs.promises.access(filePath);
                const fileBuffer = await fs.promises.readFile(filePath);
                zip.addFile(fileName, fileBuffer);
                addedCount++;
            } catch (err) {
                // File doesn't exist, skip
            }
        }

        if (addedCount === 0) {
            return res.status(404).json({
                error: 'Tidak ada chart yang tersedia',
                message: 'Silakan generate monthly report terlebih dahulu.'
            });
        }

        const zipBuffer = zip.toBuffer();
        const zipFileName = `Laporan_Charts_${bulan}_${tahun}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
        res.setHeader('Content-Length', zipBuffer.length);
        res.send(zipBuffer);
    } catch (err) {
        console.error('Error creating charts ZIP:', err);
        res.status(500).json({ error: 'Gagal membuat ZIP chart', message: err.message });
    }
});

// GET download specific chart image (with type)
app.get('/api/admin/download-chart/:bulan/:tahun/:type', authenticateAdmin, async (req, res) => {
    const { bulan, tahun, type } = req.params;

    if (!bulan || !tahun) {
        return res.status(400).json({ error: 'Bulan dan tahun diperlukan' });
    }

    try {
        const chartDir = path.join(__dirname, '..', 'charts');
        const chartFileName = `Laporan_Chart_${type}_${bulan}_${tahun}.png`;
        const chartPath = path.join(chartDir, chartFileName);

        // Check if file exists
        try {
            await fs.promises.access(chartPath);
        } catch (err) {
            return res.status(404).json({
                error: 'Chart tidak ditemukan',
                message: `File ${chartFileName} belum dibuat. Silakan generate monthly report terlebih dahulu.`
            });
        }

        // Send file
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${chartFileName}"`);

        const fileStream = fs.createReadStream(chartPath);
        fileStream.pipe(res);
    } catch (err) {
        console.error('Error downloading chart:', err);
        res.status(500).json({ error: 'Gagal mengunduh chart', message: err.message });
    }
});

// GET download chart image (backward compatibility - without type)
app.get('/api/admin/download-chart/:bulan/:tahun', authenticateAdmin, async (req, res) => {
    const { bulan, tahun } = req.params;

    if (!bulan || !tahun) {
        return res.status(400).json({ error: 'Bulan dan tahun diperlukan' });
    }

    try {
        const chartDir = path.join(__dirname, '..', 'charts');

        // Try old format first for backward compatibility
        let chartFileName = `Laporan_Chart_${bulan}_${tahun}.png`;
        let chartPath = path.join(chartDir, chartFileName);

        try {
            await fs.promises.access(chartPath);
        } catch (err) {
            // Old format doesn't exist, try Status chart
            chartFileName = `Laporan_Chart_Status_${bulan}_${tahun}.png`;
            chartPath = path.join(chartDir, chartFileName);
        }

        // Check if file exists
        try {
            await fs.promises.access(chartPath);
        } catch (err) {
            return res.status(404).json({
                error: 'Chart tidak ditemukan',
                message: `File ${chartFileName} belum dibuat. Silakan generate monthly report terlebih dahulu.`
            });
        }

        // Send file
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${chartFileName}"`);

        const fileStream = fs.createReadStream(chartPath);
        fileStream.pipe(res);
    } catch (err) {
        console.error('Error downloading chart:', err);
        res.status(500).json({ error: 'Gagal mengunduh chart', message: err.message });
    }
});

// POST generate monthly report
app.post('/api/admin/monthly-report', authenticateAdmin, async (req, res) => {
    let { bulan, tahun } = req.body;

    if (!bulan) {
        return res.status(400).json({ error: 'Bulan diperlukan' });
    }
    if (!tahun) {
        return res.status(400).json({ error: 'Tahun diperlukan' });
    }

    // Translate Indonesian month to English
    const monthTranslation = {
        'Januari': 'January', 'Februari': 'February', 'Maret': 'March', 'April': 'April',
        'Mei': 'May', 'Juni': 'June', 'Juli': 'July', 'Agustus': 'August',
        'September': 'September', 'Oktober': 'October', 'November': 'November', 'Desember': 'December'
    };
    const bulanEnglish = monthTranslation[bulan] || bulan;

    if (monthlyReportGenerationInProgress) {
        return res.status(429).json({ error: 'Laporan sedang diproses', message: 'Monthly report generation is already running. Please wait until it finishes.' });
    }

    monthlyReportGenerationInProgress = true;

    try {
        const templatePath = path.join(__dirname, '../template_with_placeholder.docx');
        const templateBuffer = await fs.promises.readFile(templatePath);

        // Open docx as zip and replace placeholders across all relevant XML parts
        const zip = new AdmZip(templateBuffer);
        const entries = zip.getEntries();
        if (!entries || entries.length === 0) {
            return res.status(500).json({ error: 'Template DOCX tidak valid' });
        }

        const interleavedBulan = new RegExp(
            '\\$\\s*(?:<[^>]+>\\s*)*b\\s*(?:<[^>]+>\\s*)*u\\s*(?:<[^>]+>\\s*)*l\\s*(?:<[^>]+>\\s*)*a\\s*(?:<[^>]+>\\s*)*n',
            'gi'
        );
        const interleavedTahun = new RegExp(
            '\\$\\s*(?:<[^>]+>\\s*)*t\\s*(?:<[^>]+>\\s*)*a\\s*(?:<[^>]+>\\s*)*h\\s*(?:<[^>]+>\\s*)*u\\s*(?:<[^>]+>\\s*)*n',
            'gi'
        );
        // Fix common template typo: "14s" -> "14" even if split across runs
        const interleaved14s = new RegExp(
            '1(?:<[^>]+>\\s*)*4(?:<[^>]+>\\s*)*s',
            'gi'
        );

        entries.forEach((entry) => {
            const name = entry.entryName;
            if (!name.startsWith('word/') || !name.endsWith('.xml')) return;
            const content = entry.getData().toString('utf8');
            let patched = content
                .replace(/\$bulan/g, bulanEnglish)
                .replace(/\$tahun/g, tahun)
                .replace(interleavedBulan, bulanEnglish)
                .replace(interleavedTahun, tahun)
                .replace(/14s/g, '14')
                .replace(interleaved14s, '14');
            if (patched !== content) {
                zip.updateFile(name, Buffer.from(patched, 'utf8'));
            }
        });

        // Read issues and prepare Tabel 1 rows (Surface issues of selected month/year)
        const issuesPath = path.join(__dirname, '../issues.json');
        try {
            const issuesData = await fs.promises.readFile(issuesPath, 'utf8');
            const issues = JSON.parse(issuesData);

            // Map English month to 3-letter abbreviation used in issues.json
            const mapEngToAbbr = {
                'January': 'Jan', 'February': 'Feb', 'March': 'Mar', 'April': 'Apr', 'May': 'May', 'June': 'Jun', 'July': 'Jul', 'August': 'Aug', 'September': 'Sep', 'October': 'Oct', 'November': 'Nov', 'December': 'Dec'
            };
            const engMon = mapEngToAbbr[bulanEnglish] || bulanEnglish;
            const yy = ('' + tahun).slice(-2);

            const filtered = issues.filter(it => {
                const cat = (it.wigosIssueCategory || '').toLowerCase();
                const summary = (it.summary || '').toLowerCase();
                const created = (it.created || ''); // e.g., 08/Jul/25
                const isSurface = cat.includes('surface') || (!cat && summary.includes('surface'));
                return isSurface && created.includes(`/${engMon}/`) && created.endsWith(yy);
            });

            // Escape helper
            const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // We'll decide cell builder later after we inspect table structure
            let rowsXml = '';
            // Helpers to enforce 8pt font and optional italic in generated cells
            const runPr = (italic) => italic
                ? '<w:rPr><w:i/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>'
                : '<w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>';
            const cell = (text, italic = false) => `
                <w:tc>
                  <w:tcPr><w:vAlign w:val="center"/></w:tcPr>
                  <w:p>
                    <w:pPr><w:jc w:val="center"/></w:pPr>
                    <w:r>${runPr(italic)}<w:t>${esc(text)}</w:t></w:r>
                  </w:p>
                </w:tc>
            `.replace(/\n\s+/g, '');
            const extractParams = (s) => {
                const terms = ['pressure', 'temperature', 'zonal wind', 'meridional wind', 'relative humidity'];
                const lower = String(s || '').toLowerCase();
                const found = terms.filter(t => lower.includes(t));
                return found.join(', ');
            };
            const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const formatDateNice = (created, summary) => {
                const c = String(created || '').trim();
                // Pattern: dd/Mon/yy (e.g., 03/Jun/25)
                let m = c.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{2})$/);
                if (m) {
                    const dd = m[1];
                    const mon = m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase();
                    const yy = parseInt(m[3], 10);
                    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
                    return `${dd} ${mon} ${yyyy}`;
                }
                // Fallback: summary starts with ddMMyyyy (e.g., 17102025-...)
                const s = String(summary || '');
                m = s.match(/^(\d{2})(\d{2})(\d{4})\b/);
                if (m) {
                    const dd = m[1];
                    const mm = parseInt(m[2], 10) - 1;
                    const yyyy = parseInt(m[3], 10);
                    const mon = monthNames[Math.max(0, Math.min(11, mm))];
                    return `${dd} ${mon} ${yyyy}`;
                }
                // As-is if unrecognized
                return c || '';
            };
            const extractCountry = (s) => {
                const str = String(s || '');
                const m = str.match(/^[^\-]*-\s*([^\-]+?)\s*-+/);
                if (!m) return '';

                let country = m[1].trim();

                // Map country codes to full names (case-insensitive)
                const countryMap = {
                    'SIN': 'Singapore',
                    'PNG': 'Papua New Guinea',
                    'ID': 'Indonesia',
                    'IDN': 'Indonesia',
                    'INDONESIA': 'Indonesia',
                    'SINGAPORE': 'Singapore',
                    'MALAYSIA': 'Malaysia',
                    'MYS': 'Malaysia',
                    'PHILIPPINES': 'Philippines',
                    'PHL': 'Philippines',
                    'THAILAND': 'Thailand',
                    'THA': 'Thailand',
                    'VIETNAM': 'Vietnam',
                    'VNM': 'Vietnam',
                    'BRUNEI': 'Brunei',
                    'BRN': 'Brunei',
                    'CAMBODIA': 'Cambodia',
                    'KHM': 'Cambodia',
                    'LAOS': 'Laos',
                    'LAO': 'Laos',
                    'MYANMAR': 'Myanmar',
                    'MMR': 'Myanmar',
                    'TIMOR LESTE': 'Timor Leste',
                    'TLS': 'Timor Leste'
                };

                // Check if country is a code that needs mapping (case-insensitive)
                const upperCountry = country.toUpperCase();
                if (countryMap[upperCountry]) {
                    return countryMap[upperCountry];
                }

                // Normalize to Title Case for consistent grouping
                // This handles cases like "INDONESIA" -> "Indonesia", "indonesia" -> "Indonesia"
                return country.split(/\s+/).map(word =>
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ');
            };
            const extractStation = (s) => {
                const parts = String(s || '').split('-').map(t => t.trim()).filter(Boolean);
                if (parts.length < 3) return '';
                // parts[0]=date, parts[1]=country, parts[2]=maybe 'GBON' or station
                let idx = 2;
                if ((parts[2] || '').toLowerCase() === 'gbon') idx = 3;
                return (parts[idx] || '').trim();
            };

            // Set debug headers for inspection
            res.setHeader('X-Table1-Rows', String(filtered.length));
            res.setHeader('X-Table1-Month', engMon);

            {
                // Inject into document.xml: locate the table after "Tabel 1" heading (robust search)
                const docEntry2 = zip.getEntry('word/document.xml');
                if (docEntry2) {
                    let xmlDoc = docEntry2.getData().toString('utf8');

                    // Regex that matches 'Tabel' and '1' across interleaved XML tags/runs
                    // More specific: look for "Tabel 1" followed by "Surface" or "surface"
                    const tabel1SurfaceRegex = new RegExp(
                        'T' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'b' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'l' +
                        '(?:<[^>]+>\\s*|[^<])*?' + '1' + '(?:<[^>]+>\\s*|[^<])*?' + '(?:[\u002E\uFF0E])?' +
                        '(?:<[^>]+>\\s*|[^<])*?' +
                        's' + '(?:<[^>]+>\\s*)*' + 'u' + '(?:<[^>]+>\\s*)*' + 'r' + '(?:<[^>]+>\\s*)*' + 'f' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'c' + '(?:<[^>]+>\\s*)*' + 'e',
                        'i'
                    );

                    const tabel1Regex = new RegExp(
                        'T' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'b' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'l' +
                        '(?:<[^>]+>\\s*|[^<])*?' + '1' + '(?:<[^>]+>\\s*|[^<])*?' + '(?:[\u002E\uFF0E])?',
                        'i'
                    );

                    let matchIdx = -1;
                    // Try surface-specific match first
                    const m1Surface = tabel1SurfaceRegex.exec(xmlDoc);
                    if (m1Surface && typeof m1Surface.index === 'number') {
                        matchIdx = m1Surface.index;
                    } else {
                        // Fallback to general Tabel 1
                        const m1 = tabel1Regex.exec(xmlDoc);
                        if (m1 && typeof m1.index === 'number') {
                            matchIdx = m1.index;
                        } else {
                            // Try plain text fallback
                            matchIdx = xmlDoc.indexOf('Table 1');
                            if (matchIdx === -1) matchIdx = xmlDoc.indexOf('Tabel 1');
                        }
                    }

                    if (matchIdx === -1) {
                        console.warn('Tabel 1 heading not found in document.xml');
                        res.setHeader('X-Table1-Error', 'Heading not found');
                    } else {
                        // Find target table by scanning tables after heading and picking FIRST one with >=7 cells
                        let startTbl = -1;
                        let scanPos = matchIdx;
                        let selectedCols = 0;
                        let tabel1EndPos = -1;

                        while (true) {
                            const cand = xmlDoc.indexOf('<w:tbl', scanPos);
                            if (cand === -1) break;
                            const tblOpenEnd = xmlDoc.indexOf('>', cand) + 1;
                            const tblEnd = xmlDoc.indexOf('</w:tbl>', tblOpenEnd);
                            if (tblEnd === -1) break;
                            const firstTrStart = xmlDoc.indexOf('<w:tr', tblOpenEnd);
                            const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                            if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < tblEnd) {
                                const headerRow = xmlDoc.slice(firstTrStart, firstTrEnd);
                                const colCount = (headerRow.match(/<w:tc\b/g) || []).length;
                                if (colCount >= 7) {
                                    startTbl = cand;
                                    selectedCols = colCount;
                                    tabel1EndPos = tblEnd + 8; // Save end position for Tabel 2 search
                                    break;
                                }
                            }
                            scanPos = tblEnd + 8;
                        }

                        if (startTbl !== -1) {
                            const endStartTbl = xmlDoc.indexOf('>', startTbl) + 1;
                            const endTbl = xmlDoc.indexOf('</w:tbl>', endStartTbl);
                            if (endTbl !== -1) {
                                // Keep the first (header) row, remove subsequent rows, insert data rows after header
                                const firstTrStart = xmlDoc.indexOf('<w:tr', endStartTbl);
                                const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                                if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < endTbl) {
                                    const afterFirstTr = firstTrEnd + '</w:tr>'.length;
                                    const xmlBefore = xmlDoc.slice(0, afterFirstTr);
                                    let between = xmlDoc.slice(afterFirstTr, endTbl);
                                    // Remove all existing data rows after header
                                    between = between.replace(/<w:tr[\s\S]*?<\/w:tr>/g, '');

                                    // Build data rows (8pt font on all cells, italic on columns 3, 6, 7)
                                    let rowsXml = '';
                                    if (filtered.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}</w:tr>`;
                                    } else {
                                        filtered.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const wigosId = it.wigosId || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            const station = extractStation(summary);
                                            const stationWithWigos = wigosId ? `${station} / ${wigosId}` : station;
                                            const niceDate = formatDateNice(created, summary);
                                            rowsXml += `<w:tr>${cell(no)}${cell(niceDate)}${cell(param, true)}${cell(stationWithWigos)}${cell(country)}${cell(category, true)}${cell(status, true)}</w:tr>`;
                                        });
                                    }

                                    const xmlAfter = xmlDoc.slice(endTbl);
                                    xmlDoc = xmlBefore + rowsXml + between + xmlAfter;

                                    const insertedCount = Math.max(1, filtered.length);
                                    res.setHeader('X-Table1-Inserted', String(insertedCount));
                                } else {
                                    // If header not found, append before end of table
                                    let rowsXml = '';
                                    if (filtered.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}</w:tr>`;
                                    } else {
                                        filtered.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            rowsXml += `<w:tr>${cell(no)}${cell(created)}${cell(param, true)}${cell(summary)}${cell(country)}${cell(category, true)}${cell(status, true)}</w:tr>`;
                                        });
                                    }
                                    xmlDoc = xmlDoc.slice(0, endTbl) + rowsXml + xmlDoc.slice(endTbl);
                                }
                            }
                            zip.updateFile('word/document.xml', Buffer.from(xmlDoc, 'utf8'));
                            if (selectedCols) {
                                res.setHeader('X-Table1-Cols', String(selectedCols));
                            }

                            // Store the end position for Tabel 2 search to start after Tabel 1
                            res.locals = res.locals || {};
                            res.locals.tabel1EndPos = tabel1EndPos;
                        } else {
                            console.warn('Tabel 1 table not found after heading');
                            res.setHeader('X-Table1-Error', 'Table not found');
                        }
                    }
                }
            }
            // === Inject Tabel 2 (Upper-air) in document.xml AFTER Tabel 1 ===
            {
                const tabel2Regex = new RegExp(
                    'T' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'b' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'l' +
                    '(?:<[^>]+>\\s*|[^<])*?' + '2' + '(?:<[^>]+>\\s*|[^<])*?' + '(?:[\u002E\uFF0E])?',
                    'i'
                );
                // Stronger heading match: contains 'upper'/'upper air' near the heading line
                const tabel2UpperRegex = new RegExp(
                    'T' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'b' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'l' +
                    '(?:<[^>]+>\\s*|[^<])*?' + '2' + '(?:<[^>]+>\\s*|[^<])*?' +
                    '(?:[\u002E\uFF0E])?' + '(?:<[^>]+>\\s*|[^<])*?' +
                    'u' + '(?:<[^>]+>\\s*)*' + 'p' + '(?:<[^>]+>\\s*)*' + 'p' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'r',
                    'i'
                );

                const filteredUA = issues.filter(it => {
                    const catRaw = (it.wigosIssueCategory || '').toLowerCase();
                    const sumRaw = (it.summary || '').toLowerCase();
                    const cat = catRaw.replace(/[\s-]+/g, ' ').trim();
                    const summary = sumRaw.replace(/[\s-]+/g, ' ').trim();
                    const created = (it.created || '');
                    const isUpper = cat.includes('upper air') || (!cat && summary.includes('upper air'));
                    return isUpper && created.includes(`/${engMon}/`) && created.endsWith(yy);
                });

                // Set debug headers for Tabel 2
                res.setHeader('X-Table2-Rows', String(filteredUA.length));

                // Process document.xml to find and update Tabel 2 (search AFTER Tabel 1)
                const docEntry3 = zip.getEntry('word/document.xml');
                if (docEntry3) {
                    let xmlDoc = docEntry3.getData().toString('utf8');

                    // Get the start position after Tabel 1 (if available)
                    const startSearchPos = (res.locals && res.locals.tabel1EndPos) ? res.locals.tabel1EndPos : 0;

                    // Try to find Tabel 2 heading AFTER Tabel 1
                    let matchIdx = -1;
                    const xmlAfterTabel1 = xmlDoc.slice(startSearchPos);
                    const m2 = tabel2UpperRegex.exec(xmlAfterTabel1);
                    if (m2 && typeof m2.index === 'number') {
                        matchIdx = startSearchPos + m2.index;
                    } else {
                        const m2Simple = tabel2Regex.exec(xmlAfterTabel1);
                        if (m2Simple && typeof m2Simple.index === 'number') {
                            matchIdx = startSearchPos + m2Simple.index;
                        } else {
                            let idx = xmlAfterTabel1.indexOf('Table 2');
                            if (idx === -1) idx = xmlAfterTabel1.indexOf('Tabel 2');
                            if (idx !== -1) matchIdx = startSearchPos + idx;
                        }
                    }

                    if (matchIdx === -1) {
                        console.warn('Tabel 2 heading not found in document.xml after Tabel 1');
                        res.setHeader('X-Table2-Error', 'Heading not found');
                    } else {
                        // Find target table after Tabel 2 heading
                        let startTbl = -1;
                        let scanPos = matchIdx;
                        let selectedCols2 = 0;

                        while (true) {
                            const cand = xmlDoc.indexOf('<w:tbl', scanPos);
                            if (cand === -1) break;
                            const tblOpenEnd = xmlDoc.indexOf('>', cand) + 1;
                            const tblEnd = xmlDoc.indexOf('</w:tbl>', tblOpenEnd);
                            if (tblEnd === -1) break;
                            const firstTrStart = xmlDoc.indexOf('<w:tr', tblOpenEnd);
                            const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                            if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < tblEnd) {
                                const headerRow = xmlDoc.slice(firstTrStart, firstTrEnd);
                                const colCount = (headerRow.match(/<w:tc\b/g) || []).length;
                                if (colCount >= 7) {
                                    startTbl = cand;
                                    selectedCols2 = colCount;
                                    break;
                                }
                            }
                            scanPos = tblEnd + 8;
                        }

                        if (startTbl !== -1) {
                            const endStartTbl = xmlDoc.indexOf('>', startTbl) + 1;
                            const endTbl = xmlDoc.indexOf('</w:tbl>', endStartTbl);
                            if (endTbl !== -1) {
                                const firstTrStart = xmlDoc.indexOf('<w:tr', endStartTbl);
                                const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                                if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < endTbl) {
                                    const afterFirstTr = firstTrEnd + '</w:tr>'.length;
                                    const xmlBefore = xmlDoc.slice(0, afterFirstTr);
                                    let between = xmlDoc.slice(afterFirstTr, endTbl);
                                    between = between.replace(/<w:tr[\s\S]*?<\/w:tr>/g, '');

                                    // Build data rows for Tabel 2
                                    let rowsXml = '';
                                    if (filteredUA.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}</w:tr>`;
                                    } else {
                                        filteredUA.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const wigosId = it.wigosId || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            const station = extractStation(summary);
                                            const stationWithWigos = wigosId ? `${station} / ${wigosId}` : station;
                                            const niceDate = formatDateNice(created, summary);
                                            rowsXml += `<w:tr>${cell(no)}${cell(niceDate)}${cell(param, true)}${cell(stationWithWigos)}${cell(country)}${cell(category, true)}${cell(status, true)}</w:tr>`;
                                        });
                                    }

                                    const xmlAfter = xmlDoc.slice(endTbl);
                                    xmlDoc = xmlBefore + rowsXml + between + xmlAfter;

                                    const insertedCount2 = Math.max(1, filteredUA.length);
                                    res.setHeader('X-Table2-Inserted', String(insertedCount2));
                                } else {
                                    // If header not found, append before end of table
                                    let rowsXml = '';
                                    if (filteredUA.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}</w:tr>`;
                                    } else {
                                        filteredUA.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            rowsXml += `<w:tr>${cell(no)}${cell(created)}${cell(param, true)}${cell(summary)}${cell(country)}${cell(category, true)}${cell(status, true)}</w:tr>`;
                                        });
                                    }
                                    xmlDoc = xmlDoc.slice(0, endTbl) + rowsXml + xmlDoc.slice(endTbl);

                                    const insertedCount2 = Math.max(1, filteredUA.length);
                                    res.setHeader('X-Table2-Inserted', String(insertedCount2));
                                }
                            }
                            zip.updateFile('word/document.xml', Buffer.from(xmlDoc, 'utf8'));
                            if (selectedCols2) {
                                res.setHeader('X-Table2-Cols', String(selectedCols2));
                            }
                            res.setHeader('X-Table2-Part', 'word/document.xml');
                        } else {
                            console.warn('Tabel 2 table not found after heading');
                            res.setHeader('X-Table2-Error', 'Table not found');
                        }
                    }
                }
            }

            // === Inject Tabel 3 (All non-OPEN issues) in document.xml AFTER Tabel 2 ===
            {
                const tabel3Regex = new RegExp(
                    'T' + '(?:<[^>]+>\\s*)*' + 'a' + '(?:<[^>]+>\\s*)*' + 'b' + '(?:<[^>]+>\\s*)*' + 'e' + '(?:<[^>]+>\\s*)*' + 'l' +
                    '(?:<[^>]+>\\s*|[^<])*?' + '3' + '(?:<[^>]+>\\s*|[^<])*?' + '(?:[\u002E\uFF0E])?',
                    'i'
                );

                // Filter all issues with status NOT equal to "CLOSED" (all issues up to current date)
                const filteredNonClosed = issues.filter(it => {
                    const status = (it.status || '').toLowerCase().trim();
                    const isNotClosed = status !== 'closed';
                    return isNotClosed;
                });

                // Set debug headers for Tabel 3
                res.setHeader('X-Table3-Rows', String(filteredNonClosed.length));

                // Process document.xml to find and update Tabel 3 (search AFTER Tabel 2)
                const docEntry4 = zip.getEntry('word/document.xml');
                if (docEntry4) {
                    let xmlDoc = docEntry4.getData().toString('utf8');

                    // Get the start position after Tabel 2 (if available)
                    const startSearchPos = (res.locals && res.locals.tabel1EndPos) ? res.locals.tabel1EndPos : 0;

                    // Try to find Tabel 3 heading AFTER Tabel 2
                    let matchIdx = -1;
                    const xmlAfterTabel2 = xmlDoc.slice(startSearchPos);
                    const m3 = tabel3Regex.exec(xmlAfterTabel2);
                    if (m3 && typeof m3.index === 'number') {
                        matchIdx = startSearchPos + m3.index;
                    } else {
                        let idx = xmlAfterTabel2.indexOf('Table 3');
                        if (idx === -1) idx = xmlAfterTabel2.indexOf('Tabel 3');
                        if (idx !== -1) matchIdx = startSearchPos + idx;
                    }

                    if (matchIdx === -1) {
                        console.warn('Tabel 3 heading not found in document.xml after Tabel 2');
                        res.setHeader('X-Table3-Error', 'Heading not found');
                    } else {
                        // Find target table after Tabel 3 heading
                        let startTbl = -1;
                        let scanPos = matchIdx;
                        let selectedCols3 = 0;

                        while (true) {
                            const cand = xmlDoc.indexOf('<w:tbl', scanPos);
                            if (cand === -1) break;
                            const tblOpenEnd = xmlDoc.indexOf('>', cand) + 1;
                            const tblEnd = xmlDoc.indexOf('</w:tbl>', tblOpenEnd);
                            if (tblEnd === -1) break;
                            const firstTrStart = xmlDoc.indexOf('<w:tr', tblOpenEnd);
                            const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                            if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < tblEnd) {
                                const headerRow = xmlDoc.slice(firstTrStart, firstTrEnd);
                                const colCount = (headerRow.match(/<w:tc\b/g) || []).length;
                                if (colCount >= 8) {
                                    startTbl = cand;
                                    selectedCols3 = colCount;
                                    break;
                                }
                            }
                            scanPos = tblEnd + 8;
                        }

                        if (startTbl !== -1) {
                            const endStartTbl = xmlDoc.indexOf('>', startTbl) + 1;
                            const endTbl = xmlDoc.indexOf('</w:tbl>', endStartTbl);
                            if (endTbl !== -1) {
                                const firstTrStart = xmlDoc.indexOf('<w:tr', endStartTbl);
                                const firstTrEnd = firstTrStart !== -1 ? xmlDoc.indexOf('</w:tr>', firstTrStart) : -1;
                                if (firstTrStart !== -1 && firstTrEnd !== -1 && firstTrEnd < endTbl) {
                                    const afterFirstTr = firstTrEnd + '</w:tr>'.length;
                                    const xmlBefore = xmlDoc.slice(0, afterFirstTr);
                                    let between = xmlDoc.slice(afterFirstTr, endTbl);
                                    between = between.replace(/<w:tr[\s\S]*?<\/w:tr>/g, '');

                                    // Build data rows for Tabel 3 (8 columns, column 8 is empty)
                                    let rowsXml = '';
                                    if (filteredNonClosed.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}${cell(' ')}</w:tr>`;
                                    } else {
                                        filteredNonClosed.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const wigosId = it.wigosId || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            const station = extractStation(summary);
                                            const stationWithWigos = wigosId ? `${station} / ${wigosId}` : station;
                                            const niceDate = formatDateNice(created, summary);
                                            // 8 columns: No, Date, Params(italic), Station/WigosId, Country, Category(italic), Status(italic), Empty
                                            rowsXml += `<w:tr>${cell(no)}${cell(niceDate)}${cell(param, true)}${cell(stationWithWigos)}${cell(country)}${cell(category, true)}${cell(status, true)}${cell(' ')}</w:tr>`;
                                        });
                                    }

                                    const xmlAfter = xmlDoc.slice(endTbl);
                                    xmlDoc = xmlBefore + rowsXml + between + xmlAfter;

                                    const insertedCount3 = Math.max(1, filteredNonClosed.length);
                                    res.setHeader('X-Table3-Inserted', String(insertedCount3));

                                    // Save Tabel 3 end position for chart insertion
                                    res.locals.tabel3EndPos = endTbl + '</w:tbl>'.length;
                                } else {
                                    // If header not found, append before end of table
                                    let rowsXml = '';
                                    if (filteredNonClosed.length === 0) {
                                        rowsXml += `<w:tr>${cell('No data')}${cell(' ')}${cell(' ', true)}${cell(' ')}${cell(' ')}${cell(' ', true)}${cell(' ', true)}${cell(' ')}</w:tr>`;
                                    } else {
                                        filteredNonClosed.forEach((it, idx) => {
                                            const no = String(idx + 1);
                                            const created = it.created || '';
                                            const summary = it.summary || '';
                                            const category = it.wigosIssueCategory || '';
                                            const status = it.status || '';
                                            const param = extractParams(summary);
                                            const country = extractCountry(summary);
                                            rowsXml += `<w:tr>${cell(no)}${cell(created)}${cell(param, true)}${cell(summary)}${cell(country)}${cell(category, true)}${cell(status, true)}${cell(' ')}</w:tr>`;
                                        });
                                    }
                                    xmlDoc = xmlDoc.slice(0, endTbl) + rowsXml + xmlDoc.slice(endTbl);

                                    const insertedCount3 = Math.max(1, filteredNonClosed.length);
                                    res.setHeader('X-Table3-Inserted', String(insertedCount3));

                                    // Save Tabel 3 end position for chart insertion
                                    res.locals.tabel3EndPos = endTbl + '</w:tbl>'.length;
                                }
                            }
                            zip.updateFile('word/document.xml', Buffer.from(xmlDoc, 'utf8'));
                            if (selectedCols3) {
                                res.setHeader('X-Table3-Cols', String(selectedCols3));
                            }
                            res.setHeader('X-Table3-Part', 'word/document.xml');
                        } else {
                            console.warn('Tabel 3 table not found after heading');
                            res.setHeader('X-Table3-Error', 'Table not found');
                        }
                    }
                }
            }

            // === Generate ALL Charts using Puppeteer ===
            // Save as separate PNG files in charts directory
            try {
                // Filter issues for the selected month/year (same as tables)
                const filteredForChart = issues.filter(it => {
                    const created = (it.created || '');
                    return created.includes(`/${engMon}/`) && created.endsWith(yy);
                });

                // Function to get color for status
                const getColorForStatus = (status) => {
                    switch (status?.toLowerCase()) {
                        case 'open': return '#B3BAC5';
                        case 'in progress': return '#C8E0F4';
                        case 'resolved': return '#00A3BF';
                        case 'closed': return '#00875A';
                        case 'to do': return '#C1C7D0';
                        case 'done': return '#00875A';
                        case 'escalated': return '#0052CC';
                        case "won't fix": return '#FF5630';
                        case 'under investigation': return '#DFE1E6';
                        case 'incident': return '#00B8D9';
                        case 'in review': return '#6554C0';
                        case 'triage': return '#FFAB00';
                        default: return '#8fd7d7';
                    }
                };

                // Function to get color for country
                const getColorForCountry = (country) => {
                    const colorMap = {
                        'Indonesia': '#e74c3c', 'Malaysia': '#f39c12', 'Papua New Guinea': '#2ecc71',
                        'Philippines': '#3498db', 'Brunei': '#95a5a6', 'United States': '#9b59b6',
                        'Singapore': '#f1c40f', 'Timor Leste': '#e67e22'
                    };
                    return colorMap[country] || '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
                };

                // Function to get color for category
                const getColorForCategory = (category) => {
                    const cat = category?.toLowerCase().trim() || '';
                    if (cat.includes('upper-air') && cat.includes('availability')) return '#e74c3c';
                    if (cat.includes('surface') && cat.includes('availability')) return '#f39c12';
                    if (cat.includes('upper-air') && cat.includes('quality')) return '#2ecc71';
                    if (cat.includes('surface') && cat.includes('quality')) return '#3498db';
                    return '#bdc3c7';
                };

                // Get countries from database
                const countriesRows = await db.query("SELECT * FROM country ORDER BY name");
                const countriesMap = {};
                countriesRows.forEach(c => {
                    countriesMap[c.country_code.toLowerCase()] = c.name;
                    countriesMap[c.name.toLowerCase()] = c.name;
                });

                // Helper function to extract country from summary
                const extractCountryFromSummary = (summary) => {
                    const sumLower = summary?.toLowerCase() || '';
                    for (const [key, name] of Object.entries(countriesMap)) {
                        if (sumLower.includes(key)) return name;
                    }
                    return null;
                };

                // === Prepare data for all charts ===
                // 1. Status counts
                const statusCounts = {};
                filteredForChart.forEach(issue => {
                    const status = issue.status?.toLowerCase().trim() || 'unknown';
                    statusCounts[status] = (statusCounts[status] || 0) + 1;
                });

                // 2. Country counts
                const countryCounts = {};
                filteredForChart.forEach(issue => {
                    const country = extractCountryFromSummary(issue.summary);
                    if (country) {
                        countryCounts[country] = (countryCounts[country] || 0) + 1;
                    }
                });

                // 3. Country-Status counts (for stacked chart)
                const countryStatusCounts = {};
                filteredForChart.forEach(issue => {
                    const country = extractCountryFromSummary(issue.summary);
                    const status = issue.status?.toLowerCase().trim() || 'unknown';
                    if (country) {
                        if (!countryStatusCounts[country]) countryStatusCounts[country] = {};
                        countryStatusCounts[country][status] = (countryStatusCounts[country][status] || 0) + 1;
                    }
                });

                // 4. Category by Country counts
                const countryCategoryCounts = {};
                filteredForChart.forEach(issue => {
                    const country = extractCountryFromSummary(issue.summary);
                    const category = issue.wigosIssueCategory?.toLowerCase().trim() || 'unknown';
                    if (country) {
                        if (!countryCategoryCounts[country]) countryCategoryCounts[country] = {};
                        countryCategoryCounts[country][category] = (countryCategoryCounts[country][category] || 0) + 1;
                    }
                });

                // Launch Puppeteer once for all charts
                console.log('Generating all charts with Puppeteer...');
                let browser;
                browser = await launchBrowserSafe();

                const chartDir = path.join(__dirname, '..', 'charts');
                try {
                    await fs.promises.access(chartDir);
                } catch (err) {
                    await fs.promises.mkdir(chartDir, { recursive: true });
                }

                const generatedCharts = [];
                const captureChartPng = async (chartHtml, viewport, screenshotOptions = { type: 'png' }) => {
                    let page;
                    try {
                        const htmlWithChartJs = chartHtml.replace('</head>', `<script>${CHARTJS_CONTENT}</script></head>`);
                        page = await browser.newPage();
                        page.setDefaultTimeout(30000);
                        page.setDefaultNavigationTimeout(30000);
                        await page.setViewport(viewport);
                        await page.setContent(htmlWithChartJs, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForFunction('window.chartReady === true', { timeout: 10000 });
                        await new Promise(resolve => setTimeout(resolve, 300));
                        return await page.screenshot(screenshotOptions);
                    } finally {
                        if (page) {
                            try { await page.close({ runBeforeUnload: false }); } catch (e) {}
                        }
                    }
                };

                // === Chart 1a: Issue Count by Status (Vertical) ===
                {
                    const labels = Object.keys(statusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(statusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:800px;height:450px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status (Vertical) - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(labels)},datasets:[{label:'Issues',data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)},borderRadius:5}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 });
                    const fileName = `Laporan_Chart_Status_Vertical_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1a saved: ${fileName}`);
                    
                    // Replace placeholder 1 with chart 1a
                    try {
                        const existing = zip.getEntry('word/media/chart1.png');
                        if (existing) zip.deleteFile('word/media/chart1.png');
                        zip.addFile('word/media/chart1.png', buffer);
                    } catch (e) {
                        console.error('Chart 1a replace error:', e.message);
                    }
                }

                // === Chart 1b: Issue Count by Status (Horizontal) ===
                {
                    const labels = Object.keys(statusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(statusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:800px;height:450px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status (Horizontal) - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(labels)},datasets:[{label:'Issues',data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)},borderRadius:5}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{stepSize:1}},y:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 });
                    const fileName = `Laporan_Chart_Status_Horizontal_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1b saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart2.png')) zip.deleteFile('word/media/chart2.png'); zip.addFile('word/media/chart2.png', buffer); } catch(e) {}
                }

                // === Chart 1c: Issue Count by Status (Pie) ===
                {
                    const labels = Object.keys(statusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(statusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:600px;height:500px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status (Pie) - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'pie',data:{labels:${JSON.stringify(labels)},datasets:[{data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)}}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'right'}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 }, { type: 'png', fullPage: true });
                    const fileName = `Laporan_Chart_Status_Pie_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1c saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart3.png')) zip.deleteFile('word/media/chart3.png'); zip.addFile('word/media/chart3.png', buffer); } catch(e) {}
                }

                // === Chart 1d: Issue Count by Status ALL (Vertical) - No month/year filter ===
                try {
                    // Count ALL issues by status (not filtered by month/year)
                    const allStatusCounts = {};
                    issues.forEach(issue => {
                        const status = issue.status?.toLowerCase().trim() || 'unknown';
                        allStatusCounts[status] = (allStatusCounts[status] || 0) + 1;
                    });
                    const labels = Object.keys(allStatusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(allStatusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:800px;height:450px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status - All Data (Vertical)</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(labels)},datasets:[{label:'Issues',data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)},borderRadius:5}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 });
                    const fileName = `Laporan_Chart_StatusAll_Vertical_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1d saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart4.png')) zip.deleteFile('word/media/chart4.png'); zip.addFile('word/media/chart4.png', buffer); } catch(e) {}
                } catch (err1d) {
                    console.error('Error generating Chart 1d (StatusAll Vertical):', err1d.message);
                }

                // === Chart 1e: Issue Count by Status ALL (Horizontal) - No month/year filter ===
                try {
                    const allStatusCounts = {};
                    issues.forEach(issue => {
                        const status = issue.status?.toLowerCase().trim() || 'unknown';
                        allStatusCounts[status] = (allStatusCounts[status] || 0) + 1;
                    });
                    const labels = Object.keys(allStatusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(allStatusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:800px;height:450px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status - All Data (Horizontal)</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(labels)},datasets:[{label:'Issues',data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)},borderRadius:5}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{stepSize:1}},y:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 });
                    const fileName = `Laporan_Chart_StatusAll_Horizontal_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1e saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart5.png')) zip.deleteFile('word/media/chart5.png'); zip.addFile('word/media/chart5.png', buffer); } catch(e) {}
                } catch (err1e) {
                    console.error('Error generating Chart 1e (StatusAll Horizontal):', err1e.message);
                }

                // === Chart 1f: Issue Count by Status ALL (Pie) - No month/year filter ===
                try {
                    const allStatusCounts = {};
                    issues.forEach(issue => {
                        const status = issue.status?.toLowerCase().trim() || 'unknown';
                        allStatusCounts[status] = (allStatusCounts[status] || 0) + 1;
                    });
                    const labels = Object.keys(allStatusCounts).map(s => s.charAt(0).toUpperCase() + s.slice(1));
                    const values = Object.values(allStatusCounts);
                    const backgroundColors = labels.map(label => getColorForStatus(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:600px;height:500px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issue Count by Status - All Data (Pie)</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'pie',data:{labels:${JSON.stringify(labels)},datasets:[{data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)}}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'right'}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 }, { type: 'png', fullPage: true });
                    const fileName = `Laporan_Chart_StatusAll_Pie_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 1f saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart6.png')) zip.deleteFile('word/media/chart6.png'); zip.addFile('word/media/chart6.png', buffer); } catch(e) {}
                } catch (err1f) {
                    console.error('Error generating Chart 1f (StatusAll Pie):', err1f.message);
                }

                // === Chart 2: Total Issues by Country ===
                {
                    const labels = Object.keys(countryCounts);
                    const values = Object.values(countryCounts);
                    const backgroundColors = labels.map(label => getColorForCountry(label));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:800px;height:450px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Total Issues by Country - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(labels)},datasets:[{label:'Issues',data:${JSON.stringify(values)},backgroundColor:${JSON.stringify(backgroundColors)},borderRadius:5}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 840, height: 550 });
                    const fileName = `Laporan_Chart_Country_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 2 saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart7.png')) zip.deleteFile('word/media/chart7.png'); zip.addFile('word/media/chart7.png', buffer); } catch(e) {}
                }

                // === Chart 3: Issues by Country and Status (Stacked) ===
                {
                    const countries = Object.keys(countryStatusCounts);
                    const allStatuses = [...new Set(Object.values(countryStatusCounts).flatMap(s => Object.keys(s)))].sort();
                    const datasets = allStatuses.map(status => ({
                        label: status.charAt(0).toUpperCase() + status.slice(1),
                        data: countries.map(c => countryStatusCounts[c][status] || 0),
                        backgroundColor: getColorForStatus(status)
                    }));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:900px;height:500px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issues by Country and Status (Stacked) - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(countries)},datasets:${JSON.stringify(datasets)}},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'top'}},scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,ticks:{stepSize:1}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 940, height: 600 });
                    const fileName = `Laporan_Chart_CountryStatus_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 3 saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart8.png')) zip.deleteFile('word/media/chart8.png'); zip.addFile('word/media/chart8.png', buffer); } catch(e) {}
                }

                // === Chart 4: Issues by Country and Category ===
                {
                    const countries = Object.keys(countryCategoryCounts).sort();
                    const allCategories = [...new Set(Object.values(countryCategoryCounts).flatMap(c => Object.keys(c)))].sort();
                    const datasets = allCategories.map(cat => ({
                        label: cat.charAt(0).toUpperCase() + cat.slice(1),
                        data: countries.map(c => countryCategoryCounts[c][cat] || 0),
                        backgroundColor: getColorForCategory(cat)
                    }));

                    const chartHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">

<style>body{margin:0;padding:20px;background:white;font-family:'Segoe UI',sans-serif}#chartContainer{width:900px;height:500px;margin:0 auto}h2{text-align:center;color:#333;margin-bottom:20px;font-size:24px}</style>
</head><body>
<h2>Issues by WIGOS Issue Category - ${bulanEnglish} ${tahun}</h2>
<div id="chartContainer"><canvas id="myChart"></canvas></div>
<script>
window.chartReady = false;
function waitForChart() {
    if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx,{type:'bar',data:{labels:${JSON.stringify(countries)},datasets:${JSON.stringify(datasets)}},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}}}});
        window.chartReady = true;
    } else {
        setTimeout(waitForChart, 100);
    }
}
waitForChart();
</script></body></html>`;

                    const buffer = await captureChartPng(chartHtml, { width: 940, height: 600 });
                    const fileName = `Laporan_Chart_Category_${bulan}_${tahun}.png`;
                    await fs.promises.writeFile(path.join(chartDir, fileName), buffer);
                    generatedCharts.push(fileName);
                    console.log(`Chart 4 saved: ${fileName}`);
                    try { if (zip.getEntry('word/media/chart9.png')) zip.deleteFile('word/media/chart9.png'); zip.addFile('word/media/chart9.png', buffer); } catch(e) {}
                }

                console.log('All charts generated successfully:', generatedCharts);
                res.setHeader('X-Chart-Files', generatedCharts.join(','));
                res.setHeader('X-Chart-Status', 'saved-separately');
                res.setHeader('X-Chart-Count', String(generatedCharts.length));
            } catch (chartError) {
                console.error('Error generating chart:', chartError);
                // Sanitize error message for HTTP header (remove newlines and special chars)
                const sanitizedError = String(chartError.message || 'Unknown error').replace(/[\r\n\t]/g, ' ').substring(0, 200);
                res.setHeader('X-Chart-Error', sanitizedError);
                // Continue without chart if error occurs
            } finally {
                if (browser) {
                    try {
                        const pages = await browser.pages();
                        await Promise.allSettled(
                            pages.map(page => page.close({ runBeforeUnload: false }))
                        );
                    } catch (e) {}
                    try { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); } catch(e) {}
                    try { browser.process()?.kill('SIGKILL'); } catch(e) {}
                }
            }
        } catch (e) {
            console.warn('Skip Tabel 1 population:', e.message);
        }

        // Fallback: load chart images from disk if not already in zip
        const chartTypes = ['Status_Vertical','Status_Horizontal','Status_Pie','StatusAll_Vertical','StatusAll_Horizontal','StatusAll_Pie','Country','CountryStatus','Category'];
        for (let i = 0; i < chartTypes.length; i++) {
            const zipPath = `word/media/chart${i+1}.png`;
            if (!zip.getEntry(zipPath)) {
                try { zip.addFile(zipPath, fs.readFileSync(path.join(__dirname,'..','charts',`Laporan_Chart_${chartTypes[i]}_${bulan}_${tahun}.png`))); } catch(e){}
            }
        }

        // Fix chart image relationships: convert external refs to internal embedded refs
        const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
        if (relsEntry) {
            let relsContent = relsEntry.getData().toString('utf8');
            relsContent = relsContent.replace(/Target="ooxWord:\/\/word\/media\/(chart\d+\.png)"\s*TargetMode="External"/g, 'Target="media/$1"');
            zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsContent, 'utf8'));
        }

        // Fix document.xml: change v:imagedata r:id="rId5" r:href="rIdX" to r:id="rIdX" (VML embedded)
        const docEntryFinal = zip.getEntry('word/document.xml');
        if (docEntryFinal) {
            let docContent = docEntryFinal.getData().toString('utf8');
            docContent = docContent.replace(/r:id="rId5"\s+r:href="(rId\d+)"/g, 'r:id="$1"');
            zip.updateFile('word/document.xml', Buffer.from(docContent, 'utf8'));
        }

        // Generate new docx buffer
        const outBuffer = zip.toBuffer();

        const safeFileName = `Laporan_Bulanan_${bulan}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
        res.send(outBuffer);
    } catch (err) {
        console.error('Error generating DOCX monthly report:', err);
        res.status(500).json({ error: 'Gagal membuat laporan bulanan' });
    } finally {
        monthlyReportGenerationInProgress = false;
    }
});

// === UPDATE FUNGSI PENGHITUNGAN NEGARA DI ENDPOINT STATS ===
// Endpoint untuk statistik yang diperlukan oleh stats.html
app.get('/api/stats/countries', authenticateMonitoring, async (req, res) => {
    try {
        const rows = filterCountryRowsForMonitoringUser(await getCountryRows(), req.monitoringUser);
        const issues = filterIssuesForMonitoringUser(
            await readIssuesData(),
            req.monitoringUser,
            buildCountryMatchers(await getCountryRows())
        );

        const countries = {};
        rows.forEach(row => {
            // Gunakan country_code untuk pencarian, tapi tampilkan name
            countries[row.country_code.toLowerCase()] = row.name;
            countries[row.name.toLowerCase()] = row.name;
        });

        // Hitung issues per negara
        const countryCounts = {};
        issues.forEach(issue => {
            const summary = issue.summary?.toLowerCase() || '';
            let found = false;
            for (const [key, name] of Object.entries(countries)) {
                if (summary.includes(key)) {
                    countryCounts[name] = (countryCounts[name] || 0) + 1;
                    found = true;
                    // Jika satu issue bisa terkait lebih dari satu negara, hapus 'break;'
                    // break;
                }
            }
            // Opsional: Hitung issue tanpa negara yang dikenali
            // if (!found) {
            //     countryCounts['Other/Unknown'] = (countryCounts['Other/Unknown'] || 0) + 1;
            // }
        });

        res.json(countryCounts);
    } catch (err) {
        console.error("Error reading issues.json:", err);
        res.status(500).json({ error: "Gagal baca file issues" });
    }
});

// Endpoint untuk statistik country & status yang diperlukan oleh stats.html
app.get('/api/stats/countries-status', authenticateMonitoring, async (req, res) => {
    try {
        const rows = filterCountryRowsForMonitoringUser(await getCountryRows(), req.monitoringUser);
        const issues = filterIssuesForMonitoringUser(
            await readIssuesData(),
            req.monitoringUser,
            buildCountryMatchers(await getCountryRows())
        );

        const countries = {};
        rows.forEach(row => {
            // Gunakan country_code untuk pencarian, tapi tampilkan name
            countries[row.country_code.toLowerCase()] = row.name;
            countries[row.name.toLowerCase()] = row.name;
        });

        // Hitung issues per negara dan status
        const countryStatusCounts = {};
        issues.forEach(issue => {
            const summary = issue.summary?.toLowerCase() || '';
            let foundCountryKey = null;

            for (const [key, name] of Object.entries(countries)) {
                if (summary.includes(key)) {
                    foundCountryKey = key;
                    break; // Hentikan pencarian setelah menemukan satu
                }
            }

            if (foundCountryKey) {
                const countryName = countries[foundCountryKey];
                const status = issue.status?.toLowerCase().trim() || 'unknown';

                if (!countryStatusCounts[countryName]) {
                    countryStatusCounts[countryName] = {};
                }

                countryStatusCounts[countryName][status] = (countryStatusCounts[countryName][status] || 0) + 1;
            }
        });

        res.json(countryStatusCounts);
    } catch (err) {
        console.error("Error reading issues.json:", err);
        res.status(500).json({ error: "Gagal baca file issues" });
    }
});

// Inisialisasi database dan jalankan server
async function startServer() {
    try {
        // Test koneksi database
        const dbConnected = await db.testConnection();
        if (!dbConnected) {
            console.error('❌ Gagal koneksi ke database MySQL');
            process.exit(1);
        }

        // Inisialisasi database (buat tabel jika belum ada)
        const dbInitialized = await db.initializeDatabase();
        if (!dbInitialized) {
            console.error('❌ Gagal inisialisasi database');
            process.exit(1);
        }

        await initializeMonitoringUsers();

        // Jalankan scraping setiap 30 menit
        const scrapeIssues = require('./scrape');
        setInterval(async () => {
            try {
                console.log("🔄 Memperbarui data issue...");
                await scrapeIssues();
            } catch (error) {
                console.error('❌ Error running scheduled scrape:', error);
            }
        }, 1000 * 60 * 30); // 30 menit

        app.listen(PORT, () => {
            console.log(`🌐 Server berjalan di http://localhost:${PORT}`);

            // Jalankan scrape awal tanpa menahan server startup.
            scrapeIssues().catch((error) => {
                console.error('❌ Error running initial scrape:', error);
            });
        });
    } catch (error) {
        console.error('❌ Error starting server:', error);
        process.exit(1);
    }
}

// Jalankan server
startServer();
