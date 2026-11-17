// server/routes/wdqms.js
// /api/wdqms-summary — aggregates the WDQMS v2 platform payloads for the
// landing page cards, with a short-lived on-disk cache.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const CACHE_DIR = path.join(__dirname, '../../cache');

const WDQMS_V2_TIMEOUT_MS = parseInt(process.env.WDQMS_V2_TIMEOUT_MS || '10000', 10) || 10000;
const WDQMS_SUMMARY_TTL_MS = parseInt(process.env.WDQMS_SUMMARY_TTL_MS || '300000', 10) || 300000;
const WDQMS_SUMMARY_LOOKBACK_DAYS = Math.max(0, parseInt(process.env.WDQMS_SUMMARY_LOOKBACK_DAYS || '14', 10) || 0);
const WDQMS_SUMMARY_CACHE_FILE = path.join(CACHE_DIR, 'wdqms-summary.json');

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

router.get('/api/wdqms-summary', async (req, res) => {
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

module.exports = router;
