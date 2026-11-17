// server/routes/monitoring.js
//
// Clean URLs for the ticket monitoring portal.
//
// The pages are still static files under public/, but the browser should see
// /monitoring/issues rather than /monitoring/index.html — the .html suffix
// advertises the implementation and makes /monitoring/admin.html an obvious
// target to probe. Old URLs redirect permanently, so existing bookmarks and
// anything already indexed keep working.
const express = require('express');
const path = require('path');

// __dirname is server/routes, so public/ is two levels up.
const PORTAL_DIR = path.join(__dirname, '../../public');

// clean slug -> file on disk
const PAGES = {
    issues: 'index.html',
    stats: 'stats.html',
    reports: 'report.html',
    about: 'about.html',
    contact: 'contact.html',
    login: 'monitoring-login.html',
    admin: 'admin.html',
    'admin-login': 'admin-login.html',
};

// Pages anyone may open without a monitoring session.
const PUBLIC_SLUGS = new Set(['login', 'admin-login', 'admin']);

const router = express.Router();

// Legacy .html -> clean URL (permanent), preserving any query string.
for (const [slug, file] of Object.entries(PAGES)) {
    router.get(`/${file}`, (req, res) => {
        const queryIndex = req.originalUrl.indexOf('?');
        const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
        res.redirect(301, `/monitoring/${slug}${query}`);
    });
}

router.get('/', (req, res) => res.redirect(302, '/monitoring/issues'));

// Clean URLs serve the underlying file.
for (const [slug, file] of Object.entries(PAGES)) {
    router.get(`/${slug}`, (req, res) => {
        res.sendFile(path.join(PORTAL_DIR, file));
    });
}

module.exports = { router, PAGES, PUBLIC_SLUGS, PORTAL_DIR };
