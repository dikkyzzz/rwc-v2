const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.LOGS_PORT || 4001;
const LOG_PATH = path.join(__dirname, '../logs/scrape.log');

// CORS allow from localhost:4000 (and same-origin)
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Raw log (text)
app.get('/scrape.log', async (req, res) => {
    try {
        const content = await fs.promises.readFile(LOG_PATH, 'utf8');
        res.type('text/plain').send(content);
    } catch (err) {
        res.status(500).type('text/plain').send(`Error reading log: ${err.message}`);
    }
});

// JSON API: last N lines
app.get('/api/logs/scrape', async (req, res) => {
    const n = parseInt(req.query.lines, 10);
    const maxLines = Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 1000;
    try {
        const content = await fs.promises.readFile(LOG_PATH, 'utf8');
        const allLines = content.split(/\r?\n/);
        const result = allLines.slice(-maxLines);
        res.json({ totalLines: allLines.length, returnedLines: result.length, lines: result });
    } catch (err) {
        res.status(500).json({ error: 'Gagal membaca log', message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Logs server on http://localhost:${PORT}`);
});






