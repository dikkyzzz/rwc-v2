// server/lib/monitoring-users.js
// Country lookup, issue filtering and the monitoring_user seeding routine.
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const {
    DEFAULT_MONITORING_PASSWORD,
    MONITORING_PRIVILEGED_SEEDS,
    createPasswordHash,
    hasGlobalMonitoringAccess
} = require('./auth');

async function getCountryRows() {
    return db.query("SELECT id, name, country_code FROM country ORDER BY name");
}

function buildCountryMatchers(rows) {
    const matchers = [];

    for (const row of rows || []) {
        if (!row || !row.name) continue;
        const name = String(row.name).trim();
        const code = row.country_code ? String(row.country_code).trim() : '';
        matchers.push({
            id: row.id,
            name,
            code,
            normalizedName: name.toLowerCase(),
            normalizedCode: code.toLowerCase()
        });
    }

    return matchers;
}

function extractCountryFromSummary(summary, countryMatchers) {
    if (!summary || !Array.isArray(countryMatchers) || countryMatchers.length === 0) {
        return null;
    }

    const normalizedSummary = String(summary).toLowerCase();
    let bestMatch = null;

    for (const matcher of countryMatchers) {
        const candidates = [matcher.normalizedName, matcher.normalizedCode].filter(Boolean);
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (normalizedSummary.includes(candidate)) {
                if (!bestMatch || candidate.length > bestMatch.matchLength) {
                    bestMatch = { matcher, matchLength: candidate.length };
                }
            }
        }
    }

    return bestMatch ? bestMatch.matcher : null;
}

async function readIssuesData() {
    // __dirname is server/lib, so the issues snapshot lives two levels up.
    const issuesFile = path.join(__dirname, '../../issues.json');
    try {
        const raw = await fs.promises.readFile(issuesFile, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        return [];
    }
}

function filterIssuesForMonitoringUser(issues, monitoringUser, countryMatchers) {
    if (!monitoringUser || hasGlobalMonitoringAccess(monitoringUser) || !monitoringUser.accessCountryName) {
        return issues;
    }

    const target = String(monitoringUser.accessCountryName).toLowerCase();
    return (issues || []).filter((issue) => {
        const summary = issue && (issue.summary || issue.issueSummary || issue.title);
        const matched = extractCountryFromSummary(summary, countryMatchers);
        if (!matched) return false;
        return String(matched.name).toLowerCase() === target
            || String(matched.code || '').toLowerCase() === String(monitoringUser.accessCountryCode || '').toLowerCase();
    });
}

function filterCountryRowsForMonitoringUser(rows, monitoringUser) {
    if (!monitoringUser || hasGlobalMonitoringAccess(monitoringUser) || !monitoringUser.accessCountryName) {
        return rows;
    }

    const target = String(monitoringUser.accessCountryName).toLowerCase();
    return (rows || []).filter((row) => String(row.name || '').toLowerCase() === target);
}

async function initializeMonitoringUsers() {
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

    const slugifyEmailSegment = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

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

module.exports = {
    getCountryRows,
    buildCountryMatchers,
    extractCountryFromSummary,
    readIssuesData,
    filterIssuesForMonitoringUser,
    filterCountryRowsForMonitoringUser,
    initializeMonitoringUsers
};
