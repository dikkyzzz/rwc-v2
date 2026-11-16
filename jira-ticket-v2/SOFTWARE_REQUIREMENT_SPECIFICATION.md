# Software Requirements Specification (SRS)

## RWC Indonesia Integrated Monitoring Platform

Version: 1.0  
Date: 2026-04-20  
Prepared from: current codebase inspection in `/home/rwc/rwc`  
Document language: English technical title with Indonesian content

---

## 1. Tujuan Dokumen

Dokumen ini mendefinisikan kebutuhan perangkat lunak untuk aplikasi terintegrasi RWC Indonesia yang terdiri dari:

- landing page publik RWC Indonesia;
- portal monitoring Jira WMO untuk issue tracking, statistik, laporan, dan administrasi;
- subsistem WDQMS untuk monitoring observasi GBON dan NWP;
- integrasi data, scraping, reporting, chart export, cache, dan operasi sistem.

Dokumen ini ditujukan untuk:

- owner produk dan stakeholder bisnis;
- developer frontend, backend, dan PHP;
- system administrator/devops;
- tim dokumentasi;
- auditor internal atau reviewer teknis.

Dokumen ini juga mencatat kondisi implementasi saat ini, termasuk gap, fitur parsial, dan ketergantungan operasional yang harus diperhatikan saat pengembangan lanjutan.

---

## 2. Ruang Lingkup Sistem

### 2.1 Nama Produk

RWC Indonesia Integrated Monitoring Platform.

### 2.2 Cakupan Bisnis

Sistem menyediakan satu ekosistem aplikasi untuk:

- menampilkan identitas dan navigasi publik RWC Indonesia;
- memonitor issue Jira WMO yang dilaporkan atau dikelola oleh RWC Indonesia;
- menganalisis issue berdasarkan status, negara, kategori WIGOS, periode, dan stasiun;
- menghasilkan laporan bulanan resmi dalam format DOCX;
- mengekspor chart dan tabel untuk kebutuhan pelaporan;
- mengelola master data country untuk pemetaan issue;
- memonitor data observasi WDQMS untuk wilayah RA-V dan USA Pacific tertentu;
- menyediakan cache, log, dan mekanisme refresh data operasional.

### 2.3 Batas Sistem

Termasuk di dalam sistem:

- landing page `/`;
- portal monitoring `/monitoring/*`;
- admin portal `/monitoring/admin-login.html` dan `/monitoring/admin.html`;
- public API dan protected API pada Node.js/Express;
- subsistem WDQMS `/wdqms/*` berbasis PHP;
- sumber data `issues.json`;
- database MySQL `jira.country`;
- chart artefacts pada folder `charts/`;
- file log operasional dan cache WDQMS.

Tidak termasuk di dalam sistem:

- editing issue langsung ke Jira WMO;
- manajemen user multi-role yang kompleks;
- workflow approval dokumen formal di luar DOCX generation;
- notifikasi email/SMS/push;
- module marine NWP yang lengkap, karena implementasi saat ini masih placeholder.

---

## 3. Metode Penyusunan

SRS ini disusun dari inspeksi implementasi aktual, terutama pada file-file berikut:

- `landingpage/index.html`, `landingpage/script.js`
- `public/index.html`, `public/stats.html`, `public/report.html`
- `public/about.html`, `public/contact.html`
- `public/admin-login.html`, `public/admin.html`
- `server/server.js`, `server/scrape.js`
- `server/config/database.js`, `server/sql/init.sql`
- `wdqms/index.php`
- `wdqms/gbon/land_surface/index.php`
- `wdqms/nwp/land_upper_air/index.php`
- `wdqms/api/*.php`
- `DEPLOYMENT_GUIDE.md`, `ADMIN_SECURITY.md`

Catatan: beberapa dokumentasi internal di `public/ilustrasi/` merepresentasikan desain/logika lama dan tidak seluruhnya identik dengan implementasi runtime saat ini. Dalam konflik antara dokumentasi internal dan kode, kode saat ini dianggap sumber kebenaran.

---

## 4. Definisi dan Istilah

| Istilah | Arti |
|---|---|
| RWC | Regional WIGOS Centre |
| WIGOS | WMO Integrated Global Observing System |
| WDQMS | WMO Data Quality Monitoring System |
| GBON | Global Basic Observing Network |
| NWP | Numerical Weather Prediction |
| Jira Issue | tiket/issue operasional yang di-scrape dari Jira WMO |
| Country master | tabel referensi negara untuk pencarian issue berdasarkan nama/kode |
| Monitoring page | halaman publik `/monitoring/*` |
| Admin token | token session admin yang disimpan di browser |
| YTD | Year to Date |
| Time period | slot waktu 00, 06, 12, 18 UTC untuk observasi 6-jam |

---

## 5. Gambaran Umum Produk

### 5.1 Perspektif Produk

Produk adalah aplikasi web hybrid dengan beberapa lapisan:

- lapisan presentasi publik untuk brand RWC Indonesia;
- lapisan monitoring issue berbasis HTML/Bootstrap/Chart.js pada `/monitoring`;
- lapisan API Node.js/Express untuk issue, country master, statistik, log, dan pelaporan;
- lapisan background scraping menggunakan Puppeteer untuk mengambil data Jira WMO ke `issues.json`;
- lapisan PHP WDQMS untuk monitoring observasi dan API laporan/timeseries/yearly;
- lapisan MySQL untuk master data negara;
- lapisan file-system untuk JSON issue, logs, cache, chart PNG, dan template DOCX.

### 5.2 Tujuan Produk

Sistem harus memungkinkan pengguna untuk:

- memahami identitas dan layanan RWC Indonesia dari landing page;
- melihat issue operasional yang sedang dipantau;
- memfilter issue secara fleksibel;
- meninjau statistik multi-dimensi;
- membuat laporan ringkas dan laporan bulanan formal;
- mengelola master data negara;
- memantau status data observasi stasiun pada modul WDQMS.

### 5.3 Kelas Pengguna

| Aktor | Deskripsi | Hak Akses |
|---|---|---|
| Public Visitor | pengunjung umum | akses landing page, monitoring pages, info pages |
| Monitoring Analyst | analis operasional | akses issue list, charts, statistics, reports |
| Report Consumer | pembaca laporan | akses report page, export chart, print/save PDF |
| Admin | operator internal | login admin, country management, logs, monthly report, ZIP chart export |
| System Operator | devops/admin server | deployment, database, scraping, backup, cache, log maintenance |
| External Data Provider | Jira WMO dan WDQMS WMO | sumber data, bukan user interaktif |

### 5.4 Asumsi Utama

- browser pengguna mendukung JavaScript modern;
- backend dapat mengakses internet untuk scraping Jira dan memanggil WMO WDQMS API;
- database MySQL tersedia dan dapat diinisialisasi;
- Chrome/Chromium tersedia untuk Puppeteer;
- deployment produksi harus menyediakan runtime Node.js dan runtime PHP;
- server memiliki hak tulis pada folder logs, charts, dan cache.

---

## 6. Konteks Sistem dan Peta Rute

### 6.1 Peta URL Utama

| URL | Tipe | Fungsi |
|---|---|---|
| `/` | public static page | landing page RWC Indonesia |
| `/monitoring/index.html` | public app page | issue list dashboard utama |
| `/monitoring/stats.html` | public app page | statistik dan analytics |
| `/monitoring/report.html` | public app page | report page, summary, station report, category report |
| `/monitoring/about.html` | public info page | deskripsi sistem dan tujuan dashboard |
| `/monitoring/contact.html` | public info page | kontak dan link terkait |
| `/monitoring/admin-login.html` | protected entry page | login admin |
| `/monitoring/admin.html` | protected app page | admin dashboard |
| `/wdqms/` | public PHP portal | portal WDQMS RWC Indonesia |
| `/wdqms/gbon/land_surface/index.php` | public PHP page | monitoring GBON surface land |
| `/wdqms/gbon/land_upper-air/index.php` | public PHP page | monitoring GBON upper-air |
| `/wdqms/nwp/land_surface/index.php` | public PHP page | monitoring NWP surface land |
| `/wdqms/nwp/land_upper_air/index.php` | public PHP page | monitoring NWP upper-air |

### 6.2 API Node.js/Express

| Endpoint | Auth | Fungsi |
|---|---|---|
| `GET /api/issues` | no | mengembalikan `issues.json` |
| `GET /api/summary` | no | total, closed, backlog untuk landing page |
| `GET /api/wdqms-summary` | no | ringkasan station dan kualitas WDQMS |
| `GET /api/last-updated` | no | waktu update `issues.json` |
| `GET /api/logs/scrape` | no di kode saat ini | baca `logs/scrape.log` |
| `GET /api/countries` | no | daftar country untuk filter publik |
| `POST /api/admin/login` | no | autentikasi admin |
| `GET /api/admin/verify` | yes | validasi token admin |
| `POST /api/admin/logout` | yes logically, tolerant | logout admin |
| `GET /api/admin/countries` | yes | daftar country admin |
| `POST /api/admin/countries` | yes | tambah country |
| `DELETE /api/admin/countries/:id` | yes | hapus country |
| `GET /api/admin/charts/:bulan/:tahun` | yes | daftar chart bulan tertentu |
| `GET /api/admin/download-all-charts/:bulan/:tahun` | yes | unduh ZIP seluruh chart |
| `GET /api/admin/download-chart/:bulan/:tahun/:type` | yes | unduh chart spesifik |
| `GET /api/admin/download-chart/:bulan/:tahun` | yes | backward compatibility |
| `POST /api/admin/monthly-report` | yes | generate laporan bulanan DOCX |
| `GET /api/stats/countries` | no | statistik issue per negara |
| `GET /api/stats/countries-status` | no | statistik issue per negara dan status |

### 6.3 API WDQMS Penting

| Endpoint | Fungsi utama | Parameter kunci |
|---|---|---|
| `/wdqms/api/gbon_land_surface_stations.php` | stasiun GBON surface untuk peta | `territory,date,period,time_period,variable` |
| `/wdqms/api/gbon_upper_air_stations.php` | stasiun GBON upper-air | `territory,date,period,variable` |
| `/wdqms/api/land_surface_nwp.php` | stasiun NWP surface | `territory,date,period,time_period,variable,monitoring_category,baseline,centers` |
| `/wdqms/api/upper_air_nwp.php` | stasiun NWP upper-air | `territory,date,period,time_period,variable,monitoring_category,baseline,centers` |
| `/wdqms/api/reports_land_surface.php` | laporan station-level GBON surface | `territory,date,period,time_period,variable` |
| `/wdqms/api/reports_upper_air.php` | laporan station-level upper-air | `territory,date,period,variable` |
| `/wdqms/api/gbon_land_surface_timeseries.php` | deret waktu per stasiun | `wigos_id,variable,period_type,date,time_period,nb_days,nb_months` |
| `/wdqms/api/reports_land_surface_yearly.php` | yearly availability per country | `year,variable` |
| `/wdqms/api/download_yearly_data.php` | unduhan data tahunan | parameter yearly/reporting |

---

## 7. Arsitektur Logis

### 7.1 Komponen Utama

1. Frontend public landing page.
2. Frontend monitoring issue dashboard.
3. Frontend analytics/statistics page.
4. Frontend report page.
5. Frontend admin login dan admin panel.
6. Backend Node.js/Express.
7. Background scraper Jira berbasis Puppeteer.
8. Database MySQL untuk master data country.
9. File store untuk `issues.json`, logs, charts, template, dan output export.
10. Subsistem WDQMS berbasis PHP beserta cache dan report APIs.

### 7.2 Alur Data High Level

1. Scraper login ke Jira WMO dan mengambil issue.
2. Hasil scrape ditulis ke `issues.json`.
3. Halaman `/monitoring/*` memanggil API Node untuk membaca `issues.json`.
4. Halaman statistik dan filter negara menggunakan tabel `country` untuk klasifikasi.
5. Admin dapat memperbarui tabel `country`.
6. Monthly report generator memakai `issues.json`, template DOCX, dan chart hasil render Puppeteer.
7. Subsistem WDQMS memanggil API WMO, menyimpan cache JSON, lalu menyajikan peta/rekap ke browser.

---

## 8. Kebutuhan Fungsional

## 8.1 Landing Page

| ID | Requirement |
|---|---|
| FR-LP-001 | Sistem harus menyediakan landing page publik pada root `/` dengan branding RWC Indonesia, WMO, dan BMKG. |
| FR-LP-002 | Landing page harus menampilkan section Home, Dashboards, About, Services, dan Contact. |
| FR-LP-003 | Landing page harus memiliki navigasi anchor yang responsif, termasuk hamburger menu untuk layar kecil. |
| FR-LP-004 | Landing page harus menampilkan dua kartu dashboard utama: WDQMS Dashboard dan Jira Ticket Monitoring. |
| FR-LP-005 | Landing page harus mengambil metrik Jira dari `/api/summary` dan menampilkan total tickets, closed, dan backlog. |
| FR-LP-006 | Landing page harus mengambil metrik WDQMS dari `/api/wdqms-summary` dan menampilkan stations monitored, GBON quality, dan NWP quality. |
| FR-LP-007 | Refresh metrik Jira harus berjalan periodik setiap 60 detik. |
| FR-LP-008 | Refresh metrik WDQMS harus berjalan periodik setiap 300 detik. |
| FR-LP-009 | Landing page harus menyediakan link ke `/monitoring/index.html` dan `/wdqms/`. |
| FR-LP-010 | Landing page harus menampilkan footer dengan navigasi, external service links, dan informasi kontak resmi. |

### Acceptance Landing Page

- Pengguna dapat membuka `/` tanpa autentikasi.
- Saat API tersedia, nilai statistik pada kartu berubah dari placeholder `-` menjadi angka aktual.
- Klik "Open Dashboard" mengarahkan ke subsistem yang sesuai.

## 8.2 Monitoring Issue Dashboard (`/monitoring/index.html`)

| ID | Requirement |
|---|---|
| FR-ISS-001 | Sistem harus menampilkan daftar issue dari `/api/issues`. |
| FR-ISS-002 | Sistem harus menampilkan chart "Issue Count by Status". |
| FR-ISS-003 | Sistem harus menyediakan mode chart Vertical, Horizontal, dan Pie. |
| FR-ISS-004 | Sistem harus menyediakan tombol unduh chart sebagai PNG. |
| FR-ISS-005 | Sistem harus menyediakan filter status. |
| FR-ISS-006 | Sistem harus menyediakan filter assignee yang dipopulasi dinamis dari data issue. |
| FR-ISS-007 | Sistem harus menyediakan filter reporter yang dipopulasi dinamis dari data issue. |
| FR-ISS-008 | Sistem harus menyediakan filter priority. |
| FR-ISS-009 | Sistem harus menyediakan filter country berbasis `/api/countries` dan nilai issue summary. |
| FR-ISS-010 | Sistem harus menyediakan filter All Months. |
| FR-ISS-011 | Sistem harus menyediakan filter year yang dipopulasi dari 2020 sampai tahun depan. |
| FR-ISS-012 | Sistem harus menyediakan filter created month. |
| FR-ISS-013 | Sistem harus menyediakan filter updated month. |
| FR-ISS-014 | Sistem harus menyediakan filter WIGOS category. |
| FR-ISS-015 | Sistem harus menyediakan tombol Clear untuk me-reset seluruh filter. |
| FR-ISS-016 | Sistem harus menyediakan export XLS berdasarkan hasil filter aktif. |
| FR-ISS-017 | Sistem harus menyediakan export PDF berdasarkan hasil filter aktif. |
| FR-ISS-018 | Tabel issue harus menampilkan kolom No, Key, Summary, Status, Assignee, Reporter, Priority, Created, Updated, Category, dan Description. |
| FR-ISS-019 | Kolom Summary harus ditampilkan sebagai teks terpotong dan dapat dibuka penuh pada modal. |
| FR-ISS-020 | Kolom Description harus ditampilkan sebagai teks terpotong dan dapat dibuka penuh pada modal. |
| FR-ISS-021 | Status pada tabel harus ditampilkan dengan badge berwarna sesuai mapping status. |
| FR-ISS-022 | Header kolom Status harus mendukung sorting ascending dan descending. |
| FR-ISS-023 | Tabel issue harus mendukung pagination 10 item per halaman. |
| FR-ISS-024 | Sistem harus menampilkan informasi auto-refresh data setiap 30 menit dan waktu update terakhir dalam WIB. |
| FR-ISS-025 | Dropdown country harus direfresh periodik setiap 2 menit dan juga saat `localStorage` key `countriesUpdated` berubah. |

### Aturan Filter Dashboard Issue

- Filter `month` dan `year` bekerja dengan logika `created OR updated`.
- Filter `created month` bekerja pada field `created`.
- Filter `updated month` bekerja pada field `updated`.
- Bila `created month` atau `updated month` digunakan bersama `year`, maka year ikut menjadi syarat untuk masing-masing filter tersebut.
- Filter country mencocokkan nama negara atau `country_code` terhadap field `summary`.

### Acceptance Dashboard Issue

- Saat filter diubah, tabel, pagination, dan chart harus ikut diperbarui.
- Export XLS dan PDF hanya mengekspor hasil filter saat ini.
- Bila tidak ada data, tabel menampilkan pesan "No data available".

## 8.3 Statistics Page (`/monitoring/stats.html`)

| ID | Requirement |
|---|---|
| FR-STAT-001 | Sistem harus menampilkan halaman statistik issue berbasis data dari `/api/issues`. |
| FR-STAT-002 | Sistem harus menampilkan chart stacked "Issues by Country and Status". |
| FR-STAT-003 | Sistem harus menampilkan chart "Issue Count by Status". |
| FR-STAT-004 | Sistem harus menampilkan chart "Total Issues by Country". |
| FR-STAT-005 | Sistem harus menampilkan chart "Issue Count by WIGOS Issue Category". |
| FR-STAT-006 | Sistem harus menyediakan filter Month, Year, Year to Date, dan To Date. |
| FR-STAT-007 | Tombol Apply harus menerapkan filter periode ke semua chart pada halaman statistik. |
| FR-STAT-008 | Tombol Clear harus mengembalikan seluruh chart ke keadaan tanpa filter. |
| FR-STAT-009 | Saat `Year to Date` aktif, input Month dan Year harus dinonaktifkan, sedangkan `To Date` harus diaktifkan. |
| FR-STAT-010 | Halaman harus menyediakan tombol download PNG untuk setiap chart. |
| FR-STAT-011 | Statistik per country harus dihitung menggunakan master data `/api/countries`. |
| FR-STAT-012 | Statistik country-status harus dihitung menggunakan `/api/stats/countries-status`. |
| FR-STAT-013 | Judul chart harus menampilkan konteks filter aktif. |

### Aturan Filter Statistics

- Filter statistik saat ini menggunakan field `created`.
- Jika tidak ada filter, seluruh issue digunakan.
- YTD berarti semua issue dengan `created_date <= to_date` terpilih.

### Acceptance Statistics

- Semua chart harus berubah konsisten setelah Apply.
- Semua chart harus kembali ke seluruh data setelah Clear.
- File PNG hasil unduhan harus menyertakan judul chart pada gambar.

## 8.4 Report Page (`/monitoring/report.html`)

| ID | Requirement |
|---|---|
| FR-RPT-001 | Sistem harus menampilkan summary jumlah issue per status. |
| FR-RPT-002 | Sistem harus menampilkan tabel "Ticket Count by Station". |
| FR-RPT-003 | Tabel station harus menampilkan kolom No, Station, WIGOS id, Country Stations, Ticket Count. |
| FR-RPT-004 | Tabel station harus menyediakan filter Country, Month, Year, To Date, Search, dan Reset. |
| FR-RPT-005 | Tabel station harus mendukung pagination 10 item per halaman. |
| FR-RPT-006 | Search station harus mencari pada station, WIGOS id, dan country. |
| FR-RPT-007 | Month, Year, dan To Date untuk tabel station harus menggunakan `created` ticket date, dengan fallback parsing tanggal dari summary bila perlu. |
| FR-RPT-008 | Sistem harus menampilkan tabel "Issue Count by WIGOS Issue Category". |
| FR-RPT-009 | Sistem harus menyediakan download CSV untuk tabel kategori. |
| FR-RPT-010 | Sistem harus menyediakan print/save PDF melalui `window.print()`. |
| FR-RPT-011 | Penghitungan station harus mengelompokkan data berdasarkan kombinasi station + WIGOS ID + country. |

### Catatan Perilaku Report Page Saat Ini

- Filter station hanya mempengaruhi tabel station.
- Summary status dan tabel kategori saat ini tetap menggunakan seluruh dataset issue.

### Acceptance Report Page

- Filter station harus langsung memperbarui tabel station.
- Jika tidak ada data station setelah filter, total harus menjadi 0.
- CSV harus mengikuti isi tabel kategori yang sedang dirender.

## 8.5 About dan Contact Pages

| ID | Requirement |
|---|---|
| FR-INF-001 | Sistem harus menyediakan halaman About yang menjelaskan purpose, system overview, data source, technology stack, dan target audience. |
| FR-INF-002 | Sistem harus menyediakan halaman Contact yang menampilkan kontak BMKG/RWC dan link terkait. |
| FR-INF-003 | Kedua halaman harus menggunakan navigasi yang konsisten dengan halaman monitoring lain. |
| FR-INF-004 | Kedua halaman harus memiliki footer standar. |

## 8.6 Autentikasi Admin

| ID | Requirement |
|---|---|
| FR-AUTH-001 | Sistem harus menyediakan halaman login admin. |
| FR-AUTH-002 | Login harus meminta username dan password. |
| FR-AUTH-003 | Password input harus mendukung show/hide toggle. |
| FR-AUTH-004 | Setelah login berhasil, sistem harus menyimpan token dan user di `localStorage`. |
| FR-AUTH-005 | Setelah login berhasil, sistem harus mengarahkan user ke `admin.html`. |
| FR-AUTH-006 | Saat halaman login dibuka dan token masih valid, user harus langsung diarahkan ke `admin.html`. |
| FR-AUTH-007 | Semua endpoint admin harus memerlukan token Bearer yang valid. |
| FR-AUTH-008 | Token admin harus kadaluarsa setelah 24 jam. |
| FR-AUTH-009 | Logout harus menghapus session server-side jika token ada dan menghapus data localStorage di browser. |
| FR-AUTH-010 | Halaman admin harus memverifikasi token saat load dan redirect ke login jika token invalid atau tidak ada. |

## 8.7 Admin Panel

| ID | Requirement |
|---|---|
| FR-ADM-001 | Admin panel harus menyediakan section Monthly Report Generation. |
| FR-ADM-002 | Admin harus dapat memilih bulan menggunakan input `type="month"`. |
| FR-ADM-003 | Admin harus dapat men-trigger pembuatan laporan DOCX bulanan. |
| FR-ADM-004 | Sistem harus menolak request laporan jika bulan tidak dipilih. |
| FR-ADM-005 | Sistem harus menampilkan status proses generate report. |
| FR-ADM-006 | Saat generate report berhasil, browser harus mengunduh file DOCX otomatis. |
| FR-ADM-007 | Admin panel harus menyediakan bulk chart export dalam ZIP. |
| FR-ADM-008 | Sistem harus memberi pesan bila chart belum tersedia. |
| FR-ADM-009 | Admin panel harus menyediakan section log viewer dengan input jumlah baris. |
| FR-ADM-010 | Admin harus dapat memuat ulang log. |
| FR-ADM-011 | Admin panel harus menyediakan section tambah country. |
| FR-ADM-012 | Form tambah country harus memerlukan `name` dan `country_code`. |
| FR-ADM-013 | Admin panel harus menampilkan daftar country yang terdaftar. |
| FR-ADM-014 | Admin harus dapat menghapus country dari daftar. |
| FR-ADM-015 | Perubahan country harus memberi sinyal `countriesUpdated` ke tab lain melalui localStorage. |

### Kebutuhan Report Generator

| ID | Requirement |
|---|---|
| FR-MR-001 | Generator laporan bulanan harus menggunakan template DOCX `template_with_placeholder.docx`. |
| FR-MR-002 | Sistem harus mengganti placeholder bulan dan tahun di template. |
| FR-MR-003 | Sistem harus mengisi Tabel 1 dengan issue surface sesuai bulan/tahun terpilih. |
| FR-MR-004 | Sistem harus mengisi Tabel 2 dengan issue upper-air sesuai bulan/tahun terpilih. |
| FR-MR-005 | Sistem harus mengisi Tabel 3 dengan issue yang status-nya tidak `closed`. |
| FR-MR-006 | Sistem harus menghasilkan chart PNG bulanan ke folder `charts/`. |
| FR-MR-007 | Sistem harus mendukung unduhan chart satuan maupun seluruh chart dalam ZIP. |
| FR-MR-008 | Hanya satu proses monthly report generation yang boleh berjalan pada satu waktu. |
| FR-MR-009 | Bila proses report sedang berjalan, server harus mengembalikan HTTP 429. |

### Jenis Chart Bulanan

- Status_Vertical
- Status_Horizontal
- Status_Pie
- StatusAll_Vertical
- StatusAll_Horizontal
- StatusAll_Pie
- Country
- CountryStatus
- Category

## 8.8 Data Ingestion dan Background Processing

| ID | Requirement |
|---|---|
| FR-DATA-001 | Sistem harus melakukan scraping issue Jira WMO menggunakan Puppeteer. |
| FR-DATA-002 | Scraper harus login via halaman SAML Jira WMO. |
| FR-DATA-003 | Scraper harus mencoba login ulang maksimal 3 kali saat gagal. |
| FR-DATA-004 | Scraper harus mengambil maksimal 5 halaman issue, 50 issue per halaman, dan menghentikan proses saat halaman tidak menghasilkan issue baru. |
| FR-DATA-005 | Hasil scraping harus disimpan ke `issues.json`. |
| FR-DATA-006 | Proses scraping harus menulis log ke `logs/scrape.log`. |
| FR-DATA-007 | Sistem harus mencegah eksekusi scrape ganda pada saat yang sama. |
| FR-DATA-008 | Scraping harus berjalan sekali saat server start. |
| FR-DATA-009 | Scraping harus dijadwalkan periodik setiap 30 menit. |
| FR-DATA-010 | Issue yang disimpan minimal harus memuat key, summary, status, assignee, reporter, priority, created, updated, description, wigosIssueCategory, dan wigosId. |

## 8.9 WDQMS Portal dan Monitoring Modules

| ID | Requirement |
|---|---|
| FR-WDQMS-001 | Sistem harus menyediakan portal WDQMS dengan modul GBON dan NWP. |
| FR-WDQMS-002 | Modul GBON surface land harus menyediakan filter period, variable, region, date, dan six-hour period. |
| FR-WDQMS-003 | Modul GBON upper-air harus menyediakan filter yang sesuai konteks upper-air. |
| FR-WDQMS-004 | Modul NWP upper-air harus menyediakan filter monitoring category, variable, monitoring centre, baseline, region, date, dan six-hour period. |
| FR-WDQMS-005 | Modul WDQMS harus menampilkan peta stasiun berbasis Leaflet. |
| FR-WDQMS-006 | Modul WDQMS harus menyediakan tombol reset view, refresh, export data, dan toggle legends. |
| FR-WDQMS-007 | Modul WDQMS harus menampilkan legenda status dan jumlah stasiun. |
| FR-WDQMS-008 | Sistem harus mendukung wilayah gabungan RA-V dan USA Pacific tertentu. |
| FR-WDQMS-009 | Endpoint WDQMS harus memvalidasi parameter query dan memakai default aman jika parameter invalid. |
| FR-WDQMS-010 | Endpoint WDQMS harus menggunakan cache file untuk mengurangi panggilan berulang ke WMO API. |
| FR-WDQMS-011 | Sistem harus menyediakan endpoint timeseries untuk analisis tren per stasiun berdasarkan WIGOS ID. |
| FR-WDQMS-012 | Sistem harus menyediakan endpoint yearly report untuk availability tahunan per negara. |
| FR-WDQMS-013 | Sistem harus menyimpan cache response WDQMS pada folder cache agar dapat dipakai ulang. |

### Status dan Klasifikasi WDQMS Saat Ini

- GBON surface mengenal status seperti complete, issues-low, issues-high, not-received.
- NWP upper-air mengenal status operational, issues, critical, not-received, oscar-issue, no-match.
- `ALL_COMBINED` dipakai untuk menggabungkan Region V dan USA Pacific tertentu.

---

## 9. Aturan Bisnis

| ID | Aturan |
|---|---|
| BR-001 | Country pada issue ditentukan dari `summary` berdasarkan nama atau kode yang ada di master country. |
| BR-002 | Year filter pada issue list disimpan sebagai 2-digit suffix sesuai format Jira date `dd/Mon/yy`. |
| BR-003 | Last updated issue list ditampilkan dalam zona waktu WIB. |
| BR-004 | Session admin berlaku 24 jam dan disimpan di memory process Node.js. |
| BR-005 | Ringkasan landing page WDQMS memakai cache 5 menit. |
| BR-006 | Cache WDQMS station APIs bersifat file-based dan dapat bertahan sampai dibersihkan manual, tergantung endpoint. |
| BR-007 | Bulk chart ZIP hanya berisi chart yang file PNG-nya benar-benar tersedia. |
| BR-008 | Generator laporan bulanan menggunakan nama bulan Indonesia pada request admin dan nama bulan Inggris untuk inject ke template bila diperlukan. |
| BR-009 | Logs viewer membaca `scrape.log` maksimum 5000 baris per request. |

---

## 10. Kebutuhan Data

### 10.1 Entitas Logis `Issue`

| Field | Tipe logis | Sumber |
|---|---|---|
| key | string | Jira scrape |
| summary | string | Jira scrape |
| status | string | Jira scrape |
| assignee | string nullable | Jira scrape |
| reporter | string nullable | Jira scrape |
| priority | string nullable | Jira scrape |
| created | string format Jira | Jira scrape |
| updated | string format Jira | Jira scrape |
| description | text nullable | Jira scrape |
| wigosIssueCategory | string nullable | Jira scrape |
| wigosId | string nullable | Jira scrape |

### 10.2 Entitas Logis `Country`

| Field | Tipe | Keterangan |
|---|---|---|
| id | integer | primary key |
| name | varchar | nama negara penuh |
| country_code | varchar | kode identifikasi untuk pencarian di summary |

### 10.3 Artefak File Operasional

| Artefak | Lokasi | Fungsi |
|---|---|---|
| issue snapshot | `issues.json` | sumber utama monitoring Jira |
| country master | MySQL `jira.country` | referensi filter country |
| scrape log | `logs/scrape.log` | log scraping issue |
| WMO sync log | `logs/wmo_sync.log` | log sinkronisasi WMO |
| WDQMS logs | `wdqms/logs/*` | log PHP WDQMS |
| charts | `charts/*.png` | hasil render chart bulanan |
| DOCX template | `template_with_placeholder.docx` | template laporan bulanan |
| WDQMS cache | `wdqms/cache/*` | cache response dan yearly data |

---

## 11. Kebutuhan Antarmuka Eksternal

### 11.1 Antarmuka Pengguna

- UI publik harus dapat diakses dari browser desktop modern.
- UI monitoring harus responsif pada lebar desktop dan tablet; mobile support minimal untuk navigasi dan pembacaan.
- Chart harus digambar menggunakan Canvas/Chart.js.
- Modal Bootstrap digunakan untuk detail summary dan description issue.
- Peta WDQMS menggunakan Leaflet.

### 11.2 Antarmuka Sistem Eksternal

| Sistem eksternal | Jenis integrasi | Tujuan |
|---|---|---|
| Jira WMO | browser automation / web scraping | mengambil issue operasional |
| WMO WDQMS API | HTTP GET CSV/JSON | data observasi dan kualitas |
| MySQL | SQL | country master |
| Local browser storage | `localStorage` | token admin, user admin, signal refresh country |

---

## 12. Kebutuhan Non-Fungsional

### 12.1 Kinerja

| ID | Requirement |
|---|---|
| NFR-PERF-001 | Halaman monitoring berbasis `issues.json` sebaiknya merender dalam waktu < 5 detik pada ukuran dataset saat ini. |
| NFR-PERF-002 | Endpoint public yang membaca file lokal harus merespons cepat pada beban normal. |
| NFR-PERF-003 | Monthly report generation boleh memerlukan waktu lebih lama, namun server harus menjaga status proses dan tidak memproses paralel report generator. |
| NFR-PERF-004 | WDQMS yearly endpoint boleh berjalan hingga 120 detik dan harus memanfaatkan cache untuk request berikutnya. |

### 12.2 Keandalan

| ID | Requirement |
|---|---|
| NFR-REL-001 | Jika scraping gagal sementara, log error harus tercatat dan proses periodik berikutnya tetap dapat berjalan. |
| NFR-REL-002 | Jika `/api/countries` gagal pada issue dashboard, sistem harus memakai fallback country default. |
| NFR-REL-003 | Jika chart tidak tersedia untuk unduhan ZIP, sistem harus memberi pesan yang jelas. |
| NFR-REL-004 | Jika token admin invalid, sistem harus redirect ke login tanpa membiarkan operasi mutasi berjalan. |

### 12.3 Keamanan

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Semua endpoint admin harus berada di belakang autentikasi Bearer token. |
| NFR-SEC-002 | Produksi tidak boleh mengandalkan hardcoded admin credentials atau hardcoded Jira credentials. |
| NFR-SEC-003 | Produksi harus menyimpan secret/kredensial di environment variables atau secret manager. |
| NFR-SEC-004 | Produksi harus menggunakan HTTPS. |
| NFR-SEC-005 | Session admin produksi sebaiknya disimpan di persistent session store seperti Redis atau database. |
| NFR-SEC-006 | Password admin produksi sebaiknya disimpan dalam bentuk hash. |
| NFR-SEC-007 | Sistem harus mempertahankan header proteksi klik minimal `X-Frame-Options` dan `Content-Security-Policy` untuk frame ancestors. |

### 12.4 Maintainability

- Struktur modul harus tetap dipisah antara landing page, monitoring, admin, backend, dan WDQMS.
- Semua endpoint baru harus terdokumentasi.
- Semua perubahan country master harus kompatibel dengan filtering existing issue dashboard dan statistics page.

### 12.5 Observability

- Sistem harus menghasilkan log scrape, log WMO, dan log redirect/cache yang dapat dibaca operator.
- Operator harus dapat melihat tail log dari UI admin untuk scrape logs.

---

## 13. Kebutuhan Deployment dan Operasional

### 13.1 Lingkungan Minimum

- Ubuntu Server 22.04 LTS atau setara.
- Node.js 18 LTS atau kompatibel.
- MySQL 8.x atau kompatibel.
- Nginx sebagai reverse proxy.
- Google Chrome/Chromium untuk Puppeteer.
- Runtime PHP yang kompatibel untuk subsistem `/wdqms`.

### 13.2 Konfigurasi

Environment minimum yang dibutuhkan:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`
- `PORT`

Environment yang seharusnya ada di produksi walaupun implementasi saat ini masih memiliki fallback:

- `JIRA_API_TOKEN` (Personal Access Token dari menu profil Jira; login SSO username/password tidak dipakai lagi)
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- secret session/auth

### 13.3 Direktori yang Harus Writable

- `logs/`
- `charts/`
- `wdqms/cache/`
- `wdqms/cache/api_responses/`
- direktori log WDQMS

### 13.4 Startup Behavior

- server harus menguji koneksi database saat startup;
- server harus menginisialisasi tabel `country` bila belum ada;
- scrape awal harus dijalankan sekali saat startup;
- scheduler 30 menit untuk scraping harus aktif setelah startup.

---

## 14. Acceptance Criteria Ringkas per Subsystem

| Subsystem | Kondisi diterima |
|---|---|
| Landing Page | navigasi, statistik live, dan link dashboard berfungsi |
| Issue Dashboard | filter, chart mode, modal, pagination, XLS/PDF export berfungsi |
| Statistics | empat chart tampil, filter periode berlaku, PNG download berfungsi |
| Report Page | station table, filters, CSV, print berfungsi |
| Admin Login | login, verify, redirect, logout berfungsi |
| Admin Panel | country CRUD, log viewer, DOCX generation, ZIP chart download berfungsi |
| Scraper | issues.json terbarui dan scrape.log terisi |
| WDQMS | modul GBON/NWP utama menampilkan kontrol, peta, dan data via API |

---

## 15. Current State Gaps dan Catatan Penting

1. `public/issues.html` saat ini file kosong, sehingga tidak dapat dianggap sebagai halaman issue list aktif. Halaman issue list utama adalah `public/index.html`.
2. Direktori `wdqms/nwp/land_marine/` ada, namun belum memiliki implementasi halaman aktif. Landing page WDQMS saat ini sudah menaut ke modul tersebut, sehingga ini adalah gap antara navigasi dan implementasi.
3. Dokumentasi lama di `public/ilustrasi/database-schema.html` masih menyebut SQLite/admin_users, sedangkan implementasi runtime saat ini memakai MySQL untuk `country` dan session admin in-memory.
4. `server/public/*` berisi salinan halaman, tetapi serving aktif di `server/server.js` menunjuk ke `../public`; folder `server/public` perlu diperlakukan sebagai salinan/deployment artefact, bukan sumber kebenaran utama.
5. Ada ketidakkonsistenan konfigurasi port pada artefak proyek: contoh env menunjukkan `4000`, sedangkan default `server.js` adalah `7000` dan deployment guide mencontohkan `7000`. Produksi harus menetapkan satu nilai `PORT` eksplisit.
6. Kredensial admin dan Jira pada implementasi saat ini masih memiliki fallback hardcoded. Ini dapat diterima hanya untuk development/testing lokal, bukan untuk produksi.
7. Route `/log` sengaja dinonaktifkan pada backend walaupun `public/log.html` masih ada sebagai artefak lama.

---

## 16. Rekomendasi Prioritas Lanjutan

### Prioritas Tinggi

- migrasi kredensial dan secret sepenuhnya ke environment variables;
- ganti session in-memory dengan persistent store;
- implementasi atau hapus link `wdqms/nwp/land_marine/`;
- rapikan route/halaman legacy seperti `issues.html` dan `log.html`.

### Prioritas Menengah

- tambah role-based access control;
- tambah audit log untuk aksi admin;
- tambah test otomatis untuk filter logic dan endpoint utama;
- tambah dokumentasi API WDQMS yang lebih formal.

### Prioritas Rendah

- satukan sumber dokumentasi teknis agar tidak ada drift antara `public/ilustrasi` dan implementasi;
- pertimbangkan penyimpanan historis issue di database, bukan file JSON tunggal.

---

## 17. Penutup

Berdasarkan implementasi saat ini, aplikasi ini bukan sekadar dashboard tunggal, melainkan platform operasional gabungan yang mencakup:

- corporate/public entry point;
- issue monitoring dan analytics;
- official reporting;
- lightweight admin backoffice;
- monitoring observasi WDQMS berbasis PHP.

Dokumen ini dapat dijadikan baseline untuk:

- dokumentasi formal proyek;
- scope freeze dan backlog refinement;
- audit teknis;
- perencanaan refactor arsitektur;
- penyusunan UAT dan acceptance checklist.

