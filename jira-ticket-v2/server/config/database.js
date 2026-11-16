// server/config/database.js
const mysql = require('mysql2/promise');

// Konfigurasi database MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jira',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true
};

// Buat connection pool
const pool = mysql.createPool(dbConfig);

// Test koneksi database
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Koneksi MySQL berhasil');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Error koneksi MySQL:', error.message);
        return false;
    }
}

// Fungsi untuk menjalankan query
async function query(sql, params = []) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Fungsi untuk menjalankan query dengan callback (untuk kompatibilitas dengan kode SQLite yang ada)
function queryWithCallback(sql, params, callback) {
    query(sql, params)
        .then(rows => callback(null, rows))
        .catch(error => callback(error, null));
}

// Fungsi untuk menjalankan query INSERT/UPDATE/DELETE
async function execute(sql, params = []) {
    try {
        const [result] = await pool.execute(sql, params);
        return result;
    } catch (error) {
        console.error('Database execute error:', error);
        throw error;
    }
}

// Fungsi untuk menjalankan execute dengan callback
function executeWithCallback(sql, params, callback) {
    execute(sql, params)
        .then(result => callback(null, result))
        .catch(error => callback(error, null));
}

// Fungsi untuk membuat database dan tabel jika belum ada
async function initializeDatabase() {
    try {
        // Buat database jika belum ada
        const createDbConfig = { ...dbConfig };
        delete createDbConfig.database;
        const tempPool = mysql.createPool(createDbConfig);
        
        await tempPool.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
        console.log(`✅ Database '${dbConfig.database}' siap`);
        
        await tempPool.end();
        
        // Buat tabel country jika belum ada
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS country (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                country_code VARCHAR(10) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;
        
        await query(createTableSQL);
        console.log('✅ Tabel country siap');
        
        return true;
    } catch (error) {
        console.error('❌ Error inisialisasi database:', error);
        return false;
    }
}

module.exports = {
    pool,
    query,
    queryWithCallback,
    execute,
    executeWithCallback,
    testConnection,
    initializeDatabase
};
