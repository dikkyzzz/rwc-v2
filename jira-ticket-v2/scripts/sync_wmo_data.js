// scripts/sync_wmo_data.js
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../wdqms_data');
const LOG_FILE = path.join(__dirname, '../logs/wmo_sync.log');

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
}

// Log function
async function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;
    console.log(logMessage.trim());
    await fs.appendFile(LOG_FILE, logMessage);
}

// Download data from WMO API
async function downloadWMOData(params) {
    const { territory, date, period, time_period, variable } = params;
    
    const baseUrl = 'https://wdqms.wmo.int/wdqmsapi/v1/download/gbon/synop';
    const url = `${baseUrl}/${period}/availability/?date=${date}&period=${time_period}&variable=${variable}&centers=DWD,ECMWF,JMA,NCEP`;
    
    await log(`Downloading: ${url}`);
    
    try {
        const response = await axios.get(url, { timeout: 60000 });
        return response.data;
    } catch (error) {
        await log(`Error downloading: ${error.message}`);
        throw error;
    }
}

// Save data to local file
async function saveData(params, data) {
    const { territory, date, period, time_period, variable } = params;
    const filename = `${territory}_${date}_${period}_${time_period}_${variable}.json`;
    const filepath = path.join(DATA_DIR, filename);
    
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    await log(`Saved: ${filename}`);
}

// Sync data for specific parameters
async function syncData(params) {
    try {
        const data = await downloadWMOData(params);
        await saveData(params, data);
        return { success: true, params };
    } catch (error) {
        await log(`Failed to sync: ${JSON.stringify(params)} - ${error.message}`);
        return { success: false, params, error: error.message };
    }
}

// Main sync function
async function main() {
    await ensureDirectories();
    await log('=== WMO Data Sync Started ===');
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const date = yesterday.toISOString().split('T')[0];
    
    const territories = ['ALL_COMBINED']; // Only sync ALL_COMBINED
    const variables = ['pressure', 'temperature', 'zonal_wind', 'meridional_wind', 'humidity'];
    const periods = ['six_hour', 'daily', 'monthly'];
    const time_periods = ['00', '06', '12', '18'];
    
    const tasks = [];
    
    // Generate all combinations
    for (const territory of territories) {
        for (const variable of variables) {
            for (const period of periods) {
                if (period === 'six_hour') {
                    for (const time_period of time_periods) {
                        tasks.push({ territory, date, period, time_period, variable });
                    }
                } else {
                    tasks.push({ territory, date, period, time_period: '00', variable });
                }
            }
        }
    }
    
    await log(`Total tasks: ${tasks.length}`);
    
    // Process tasks with delay to avoid rate limiting
    let success = 0;
    let failed = 0;
    
    for (let i = 0; i < tasks.length; i++) {
        const result = await syncData(tasks[i]);
        if (result.success) {
            success++;
        } else {
            failed++;
        }
        
        // Progress
        if ((i + 1) % 10 === 0) {
            await log(`Progress: ${i + 1}/${tasks.length} (Success: ${success}, Failed: ${failed})`);
        }
        
        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await log(`=== Sync Completed: Success=${success}, Failed=${failed} ===`);
}

// Run if called directly
if (require.main === module) {
    main().catch(async (error) => {
        await log(`Fatal error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { syncData, downloadWMOData };
