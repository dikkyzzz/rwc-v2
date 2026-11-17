// server/routes/pages.js
// Static landing pages, Activities clean URLs and legacy redirects.
const express = require('express');
const path = require('path');

const router = express.Router();

const LANDING_DIR = path.join(__dirname, '../../landingpage');

router.get('/log', (req, res) => {
    res.status(404).send('Not Found');
});

// Clean URLs for Activities landing pages.
// CARA TAMBAH TRAINING/WORKSHOP BARU: copy file detail
// landingpage/training-<slug>.html lalu daftarkan slug di bawah.
const capacityTrainingPages = {
    'im-metadata-wigos-tools': 'training-im-metadata-wigos-tools.html',
};

router.get('/activities', (req, res) => {
    res.sendFile(path.join(LANDING_DIR, 'activities.html'));
});

router.get('/activities/capacity-development', (req, res) => {
    res.sendFile(path.join(LANDING_DIR, 'capacity-development.html'));
});

router.get('/activities/coordination-meeting', (req, res) => {
    res.sendFile(path.join(LANDING_DIR, 'coordination-meeting.html'));
});

router.get('/activities/capacity-development/:slug', (req, res) => {
    const file = capacityTrainingPages[req.params.slug];
    if (!file) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(LANDING_DIR, file));
});

// Backward compat: redirect URL lama ke struktur Activities baru.
router.get('/capacity-development', (req, res) => res.redirect(301, '/activities/capacity-development'));
router.get('/capacity-development/:slug', (req, res) => res.redirect(301, '/activities/capacity-development/' + req.params.slug));

module.exports = router;
