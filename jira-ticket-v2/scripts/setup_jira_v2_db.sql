-- =============================================================
-- Isolasi database untuk rwc-v2 (jira-ticket-v2)
-- =============================================================
-- Tujuan: v2 tidak lagi memakai database produksi `jira`.
-- Jalankan sekali sebagai root MySQL:
--
--   sudo mysql < scripts/setup_jira_v2_db.sql
--
-- Idempoten: aman dijalankan berulang kali.
-- =============================================================

-- 1. Database terpisah untuk v2
CREATE DATABASE IF NOT EXISTS `jira_v2`
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_general_ci;

-- 2. Salin struktur tabel (persis sama, termasuk collation & index)
CREATE TABLE IF NOT EXISTS `jira_v2`.`country` LIKE `jira`.`country`;
CREATE TABLE IF NOT EXISTS `jira_v2`.`monitoring_user` LIKE `jira`.`monitoring_user`;

-- 3. Salin isi tabel (INSERT IGNORE -> tidak menimpa bila sudah ada)
INSERT IGNORE INTO `jira_v2`.`country`
    SELECT * FROM `jira`.`country`;

INSERT IGNORE INTO `jira_v2`.`monitoring_user`
    SELECT * FROM `jira`.`monitoring_user`;

-- 4. Beri hak akses user `rwc` hanya pada database v2
--    (grant lama `jira.*` tetap ada, dipakai aplikasi produksi)
GRANT ALL PRIVILEGES ON `jira_v2`.* TO 'rwc'@'localhost';

FLUSH PRIVILEGES;

-- 5. Verifikasi
SELECT 'country' AS tabel, COUNT(*) AS baris FROM `jira_v2`.`country`
UNION ALL
SELECT 'monitoring_user', COUNT(*) FROM `jira_v2`.`monitoring_user`;
