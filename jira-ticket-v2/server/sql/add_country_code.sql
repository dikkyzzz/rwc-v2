-- server/sql/add_country_code.sql
-- Script untuk menambahkan kolom country_code ke tabel country yang sudah ada

USE jira;

-- Tambahkan kolom country_code jika belum ada
ALTER TABLE country ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) NOT NULL DEFAULT '';

-- Update data yang sudah ada dengan kode negara
UPDATE country SET country_code = 'ID' WHERE name = 'Indonesia';
UPDATE country SET country_code = 'TH' WHERE name = 'Thailand';
UPDATE country SET country_code = 'MY' WHERE name = 'Malaysia';
UPDATE country SET country_code = 'SG' WHERE name = 'Singapore';
UPDATE country SET country_code = 'PH' WHERE name = 'Philippines';
UPDATE country SET country_code = 'VN' WHERE name = 'Vietnam';
UPDATE country SET country_code = 'BN' WHERE name = 'Brunei';
UPDATE country SET country_code = 'MM' WHERE name = 'Myanmar';
UPDATE country SET country_code = 'KH' WHERE name = 'Cambodia';
UPDATE country SET country_code = 'LA' WHERE name = 'Laos';
UPDATE country SET country_code = 'JP' WHERE name = 'Japan';
UPDATE country SET country_code = 'KR' WHERE name = 'Korea';
UPDATE country SET country_code = 'CN' WHERE name = 'China';
UPDATE country SET country_code = 'IN' WHERE name = 'India';
UPDATE country SET country_code = 'AU' WHERE name = 'Australia';
UPDATE country SET country_code = 'NZ' WHERE name = 'New Zealand';
UPDATE country SET country_code = 'FJ' WHERE name = 'Fiji';
UPDATE country SET country_code = 'PG' WHERE name = 'Papua New Guinea';
UPDATE country SET country_code = 'WS' WHERE name = 'Samoa';
UPDATE country SET country_code = 'TO' WHERE name = 'Tonga';

-- Buat index untuk country_code
CREATE INDEX IF NOT EXISTS idx_country_code ON country(country_code);





