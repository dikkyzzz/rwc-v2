-- server/sql/init.sql
-- Script SQL untuk inisialisasi database MySQL

-- Buat database jika belum ada
CREATE DATABASE IF NOT EXISTS jira 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Gunakan database
USE jira;

-- Buat tabel country
CREATE TABLE IF NOT EXISTS country (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT 'Nama lengkap negara',
    country_code VARCHAR(10) NOT NULL COMMENT 'Kode negara'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tabel untuk menyimpan daftar negara';

-- Insert beberapa data contoh negara
INSERT IGNORE INTO country (name, country_code) VALUES 
('Indonesia', 'ID'),
('Thailand', 'TH'),
('Malaysia', 'MY'),
('Singapore', 'SG'),
('Philippines', 'PH'),
('Vietnam', 'VN'),
('Brunei', 'BN'),
('Myanmar', 'MM'),
('Cambodia', 'KH'),
('Laos', 'LA'),
('Japan', 'JP'),
('Korea', 'KR'),
('China', 'CN'),
('India', 'IN'),
('Australia', 'AU'),
('New Zealand', 'NZ'),
('Fiji', 'FJ'),
('Papua New Guinea', 'PG'),
('Samoa', 'WS'),
('Tonga', 'TO');

-- Buat index untuk performa pencarian
CREATE INDEX idx_country_name ON country(name);
CREATE INDEX idx_country_code ON country(country_code);
