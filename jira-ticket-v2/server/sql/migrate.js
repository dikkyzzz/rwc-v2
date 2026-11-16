// server/sql/migrate.js
// Script untuk menambahkan kolom country_code ke tabel country yang sudah ada

const mysql = require('mysql2/promise');

async function migrate() {
    let connection;
    
    try {
        // Koneksi ke database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'jira',
            port: process.env.DB_PORT || 3306
        });

        console.log('✅ Terhubung ke database MySQL');

        // Cek apakah kolom country_code sudah ada
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'country' AND COLUMN_NAME = 'country_code'
        `, [process.env.DB_NAME || 'jira']);

        if (columns.length === 0) {
            console.log('🔄 Menambahkan kolom country_code...');
            
            // Tambahkan kolom country_code
            await connection.execute(`
                ALTER TABLE country ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT ''
            `);
            
            console.log('✅ Kolom country_code berhasil ditambahkan');

            // Update data yang sudah ada dengan kode negara
            const countries = [
                { name: 'Indonesia', code: 'ID' },
                { name: 'Thailand', code: 'TH' },
                { name: 'Malaysia', code: 'MY' },
                { name: 'Singapore', code: 'SG' },
                { name: 'Philippines', code: 'PH' },
                { name: 'Vietnam', code: 'VN' },
                { name: 'Brunei', code: 'BN' },
                { name: 'Myanmar', code: 'MM' },
                { name: 'Cambodia', code: 'KH' },
                { name: 'Laos', code: 'LA' },
                { name: 'Japan', code: 'JP' },
                { name: 'Korea', code: 'KR' },
                { name: 'China', code: 'CN' },
                { name: 'India', code: 'IN' },
                { name: 'Australia', code: 'AU' },
                { name: 'New Zealand', code: 'NZ' },
                { name: 'Fiji', code: 'FJ' },
                { name: 'Papua New Guinea', code: 'PG' },
                { name: 'Samoa', code: 'WS' },
                { name: 'Tonga', code: 'TO' }
            ];

            for (const country of countries) {
                await connection.execute(
                    'UPDATE country SET country_code = ? WHERE name = ?',
                    [country.code, country.name]
                );
            }

            console.log('✅ Data country_code berhasil diupdate');

            // Buat index untuk country_code
            await connection.execute(`
                CREATE INDEX idx_country_code ON country(country_code)
            `);
            
            console.log('✅ Index country_code berhasil dibuat');
        } else {
            console.log('ℹ️ Kolom country_code sudah ada, tidak perlu migrasi');
        }

        console.log('🎉 Migrasi selesai!');

    } catch (error) {
        console.error('❌ Error migrasi:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Jalankan migrasi
migrate();





