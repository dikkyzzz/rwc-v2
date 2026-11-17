// server/jira-client.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Jira WMO memakai SSO. Login username/password sudah dinonaktifkan, jadi
// scraper memakai Personal Access Token (PAT) yang dibuat dari menu profil Jira.
// - Jira Server/Data Center : Authorization: Bearer <token>
// - Jira Cloud              : Authorization: Basic base64(email:token)  (set JIRA_EMAIL)
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || 'https://jira.wmo.int').replace(/\/+$/, '');
const JIRA_API_VERSION = process.env.JIRA_API_VERSION || '2';
const JIRA_JQL = process.env.JIRA_JQL || 'reporter in ("RWC Indonesia") ORDER BY created DESC';
const JIRA_PAGE_SIZE = Math.max(1, parseInt(process.env.JIRA_PAGE_SIZE || '50', 10) || 50);
const JIRA_MAX_PAGES = Math.max(1, parseInt(process.env.JIRA_MAX_PAGES || '5', 10) || 5);
const JIRA_TIMEOUT_MS = parseInt(process.env.JIRA_TIMEOUT_MS || '60000', 10) || 60000;

// Fungsi timestamp dalam WIB
function getWIBTimestamp() {
    const now = new Date();
    return new Date(now.getTime() + (7 * 60 * 60 * 1000)).toISOString().replace('T', ' ').split('.')[0];
}

// Log ke file scrape.log
function logToFile(message) {
    const timestamp = getWIBTimestamp();
    const logMessage = `[${timestamp}] ${message}\n`;
    const logPath = path.join(__dirname, '../logs/scrape.log');

    if (!fs.existsSync(path.dirname(logPath))) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
    }

    fs.appendFileSync(logPath, logMessage);
}

// Jira mengembalikan tanggal ISO, sedangkan frontend memakai format dd/Mon/yy
// (contoh: 08/Jul/25). Format memakai zona waktu Jira/WIB agar sama seperti
// hasil scraping HTML sebelumnya.
const JIRA_TIMEZONE = process.env.JIRA_TIMEZONE || 'Asia/Jakarta';
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: JIRA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: '2-digit'
});

function formatJiraDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = dateFormatter.formatToParts(date);
    const getPart = (type) => parts.find((part) => part.type === type)?.value;
    const day = getPart('day');
    const month = getPart('month');
    const year = getPart('year');

    return day && month && year ? `${day}/${month}/${year}` : null;
}

// Ambil teks dari nilai field Jira yang bisa berupa string, object {value}, array,
// atau dokumen ADF (Jira Cloud).
function fieldToText(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === 'string') {
        return value.trim() || null;
    }

    if (Array.isArray(value)) {
        const parts = value.map(fieldToText).filter(Boolean);
        return parts.length ? parts.join(', ') : null;
    }

    if (typeof value === 'object') {
        if (value.value !== undefined) return fieldToText(value.value);
        if (value.name !== undefined) return fieldToText(value.name);
        if (value.displayName !== undefined) return fieldToText(value.displayName);
        return null;
    }

    return String(value);
}

function descriptionToText(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.trim() || null;

    // Atlassian Document Format (Jira Cloud)
    const texts = [];
    const walk = (node) => {
        if (!node) return;
        if (typeof node === 'string') {
            texts.push(node);
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (node.type === 'text' && node.text) {
            texts.push(node.text);
        }
        if (Array.isArray(node.content)) {
            node.content.forEach(walk);
        }
    };
    walk(value);

    return texts.join(' ').replace(/\s+/g, ' ').trim() || null;
}

// Header autentikasi berbasis token. Lewati username/password sepenuhnya.
function buildAuthHeader() {
    const token = String(process.env.JIRA_API_TOKEN || '').trim();
    if (!token) return null;

    const email = String(process.env.JIRA_EMAIL || '').trim();
    if (email) {
        return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    }

    return `Bearer ${token}`;
}

function createJiraClient() {
    const authHeader = buildAuthHeader();

    return axios.create({
        baseURL: JIRA_BASE_URL,
        timeout: JIRA_TIMEOUT_MS,
        headers: {
            Authorization: authHeader,
            Accept: 'application/json'
        },
        httpsAgent: process.env.JIRA_VERIFY_SSL === 'false'
            ? new https.Agent({ rejectUnauthorized: false })
            : undefined
    });
}

// Cari ID custom field WIGOS secara otomatis. Env var bisa dipakai untuk override.
async function resolveWigosFields(client) {
    let categoryField = String(process.env.JIRA_WIGOS_CATEGORY_FIELD || '').trim() || null;
    let wigosIdField = String(process.env.JIRA_WIGOS_ID_FIELD || '').trim() || null;

    if (categoryField && wigosIdField) {
        return { categoryField, wigosIdField };
    }

    try {
        const { data } = await client.get(`/rest/api/${JIRA_API_VERSION}/field`);
        if (Array.isArray(data)) {
            const normalize = (value) => String(value || '').toLowerCase().trim();
            if (!categoryField) {
                const match = data.find((field) => normalize(field.name).includes('wigos issue category'));
                if (match) categoryField = match.id;
            }
            if (!wigosIdField) {
                const match = data.find((field) => normalize(field.name) === 'wigos id')
                    || data.find((field) => normalize(field.name).includes('wigos id'));
                if (match) wigosIdField = match.id;
            }
        }
    } catch (error) {
        logToFile(`⚠️ Gagal membaca daftar field Jira: ${error.message}`);
    }

    return {
        categoryField: categoryField || 'customfield_10008', // fallback perilaku lama
        wigosIdField
    };
}

function mapIssue(issue, wigosFields) {
    const fields = issue.fields || {};
    const categoryKey = wigosFields.categoryField;
    const wigosIdKey = wigosFields.wigosIdField;

    return {
        key: issue.key || null,
        summary: fields.summary ? String(fields.summary).trim() : null,
        status: fields.status?.name || null,
        assignee: fields.assignee?.displayName || fields.assignee?.name || null,
        reporter: fields.reporter?.displayName || fields.reporter?.name || null,
        priority: fields.priority?.name || null,
        created: formatJiraDate(fields.created),
        updated: formatJiraDate(fields.updated),
        description: descriptionToText(fields.description),
        wigosIssueCategory: categoryKey ? fieldToText(fields[categoryKey]) : null,
        wigosId: wigosIdKey ? fieldToText(fields[wigosIdKey]) : null
    };
}

let isScraping = false; // 🔒 Cegah eksekusi ganda

async function fetchIssues() {
    if (isScraping) {
        logToFile("⏳ Pengambilan data masih berjalan, skip...");
        return;
    }

    if (!buildAuthHeader()) {
        logToFile("❌ JIRA_API_TOKEN belum diisi. Pengambilan data dibatalkan (Jira WMO memakai Personal Access Token).");
        return;
    }

    isScraping = true;

    try {
        logToFile(`🔐 Menghubungi Jira WMO via REST API (${JIRA_BASE_URL})...`);
        const client = createJiraClient();

        // Validasi token sekaligus pastikan sesi/akun aktif.
        try {
            const { data: myself } = await client.get(`/rest/api/${JIRA_API_VERSION}/myself`);
            logToFile(`✅ Token valid untuk: ${myself.displayName || myself.name || myself.emailAddress || 'unknown'}`);
        } catch (error) {
            const status = error.response?.status;
            logToFile(`❌ Token ditolak Jira (HTTP ${status || 'N/A'}): ${error.response?.data?.message || error.message}`);
            return;
        }

        const wigosFields = await resolveWigosFields(client);
        logToFile(`🧭 Field WIGOS: category=${wigosFields.categoryField || '-'}, id=${wigosFields.wigosIdField || '-'}`);

        const baseFields = ['key', 'summary', 'status', 'assignee', 'reporter', 'priority', 'created', 'updated', 'description'];
        if (wigosFields.categoryField) baseFields.push(wigosFields.categoryField);
        if (wigosFields.wigosIdField) baseFields.push(wigosFields.wigosIdField);

        const allIssues = [];
        const seenKeys = new Set();
        let startAt = 0;

        for (let pageNum = 1; pageNum <= JIRA_MAX_PAGES; pageNum++) {
            logToFile(`📄 Mengambil halaman ${pageNum} (startAt=${startAt}, maxResults=${JIRA_PAGE_SIZE})...`);

            const { data } = await client.get(`/rest/api/${JIRA_API_VERSION}/search`, {
                params: {
                    jql: JIRA_JQL,
                    startAt,
                    maxResults: JIRA_PAGE_SIZE,
                    fields: baseFields.join(',')
                }
            });

            const issues = Array.isArray(data.issues) ? data.issues : [];
            if (issues.length === 0) {
                logToFile(`⚠️ Tidak ada issue ditemukan di halaman ${pageNum}`);
                break;
            }

            let newCount = 0;
            for (const issue of issues) {
                if (!issue.key || seenKeys.has(issue.key)) continue;
                seenKeys.add(issue.key);
                allIssues.push(mapIssue(issue, wigosFields));
                newCount++;
            }

            logToFile(`🔍 Halaman ${pageNum}: ${issues.length} issue, ${newCount} baru (total ${allIssues.length})`);

            if (newCount === 0) {
                logToFile(`🔁 Halaman ${pageNum} tidak memiliki issue baru. Berhenti scraping.`);
                break;
            }

            if (issues.length < JIRA_PAGE_SIZE) {
                logToFile(`🚫 Hanya ditemukan ${issues.length} issue di halaman ${pageNum}. Tidak ada halaman berikutnya.`);
                break;
            }

            startAt += JIRA_PAGE_SIZE;
        }

        const filePath = path.join(__dirname, '../issues.json');
        if (allIssues.length === 0 && fs.existsSync(filePath)) {
            try {
                const existingIssues = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(existingIssues) && existingIssues.length > 0) {
                    logToFile(`🛡️ Scrape menghasilkan 0 issue; mempertahankan ${existingIssues.length} issue yang sudah ada`);
                    return;
                }
            } catch (e) {
                logToFile(`⚠️ Gagal membaca issues.json lama sebelum overwrite: ${e.message}`);
            }
        }

        fs.writeFileSync(filePath, JSON.stringify(allIssues, null, 2), 'utf-8');
        logToFile(`📦 Total ${allIssues.length} issue disimpan`);

    } catch (err) {
        logToFile(`❌ Error terjadi: ${err.message}`);
    } finally {
        isScraping = false;
        logToFile("🔚 Scraping selesai.");
    }
}

if (require.main === module) {
    // Jalankan scraping otomatis setiap 30 menit
    setInterval(async () => {
        console.log("🔄 Memperbarui data issue...");
        await fetchIssues();
    }, 30 * 60 * 1000);

    // Jalankan sekali saat script dijalankan langsung
    fetchIssues();
}

module.exports = fetchIssues;
module.exports.formatJiraDate = formatJiraDate;
module.exports.fieldToText = fieldToText;
module.exports.descriptionToText = descriptionToText;
