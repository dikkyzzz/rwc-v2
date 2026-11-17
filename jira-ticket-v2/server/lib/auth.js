// server/lib/auth.js
// Session store, password hashing, cookie helpers and auth middleware.
const crypto = require('crypto');

// Simple in-memory session store (untuk production, gunakan Redis atau database)
const sessions = new Map();
const monitoringSessions = new Map();

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

function setMonitoringSessionCookie(req, res, token, isSecureRequest) {
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

function clearMonitoringSessionCookie(req, res, isSecureRequest) {
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
    if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
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

module.exports = {
    sessions,
    monitoringSessions,
    SESSION_MAX_AGE_MS,
    MONITORING_SESSION_COOKIE,
    DEFAULT_MONITORING_PASSWORD,
    MONITORING_PRIVILEGED_SEEDS,
    generateToken,
    createPasswordHash,
    verifyPassword,
    parseCookies,
    setMonitoringSessionCookie,
    clearMonitoringSessionCookie,
    hasGlobalMonitoringAccess,
    getMonitoringSessionFromRequest,
    authenticateMonitoring,
    monitoringPageAuth,
    authenticateAdmin,
    requireSuperAdmin
};
