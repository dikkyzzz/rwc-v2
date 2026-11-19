# Catatan Perubahan — RWC Indonesia v2

Dokumen ini merekam perjalanan platform dari cara operasional lama (v1) sampai
kondisi sekarang, termasuk daftar pekerjaan yang baru saja selesai dan hal yang
masih terbuka.

- **Repo induk:** `rwc-v2` (berisi `landingpage/`, `jira-ticket-v2/`, `wdqms-v2/`)
- **Referensi API:** [`wdqms-v2/docs/API.md`](wdqms-v2/docs/API.md)
- **Deploy:** [`wdqms-v2/docs/DEPLOY.md`](wdqms-v2/docs/DEPLOY.md)
- **Review awal:** [`wdqms-v2/docs/REVIEW.md`](wdqms-v2/docs/REVIEW.md)

---

## 1. Cara kerja lama (v1) — operasional manual

| Aspek | v1 |
| --- | --- |
| Backend WDQMS | PHP murni |
| Data dashboard | File JSON cache yang **diregenerasi 3–10 menit** (`yearly_optimized_*.json`) |
| Sumber data | Unduh CSV dari WMO WDQMS API |
| Penjadwalan | Cron |
| Portal tiket | Tidak terpisah — dashboard tiket dan WDQMS bercampur |
| Agregasi | Dihitung saat generate cache; satu angka dipakai semua tampilan |
| Halaman laporan | Statis, PDF diunduh manual |
| Autentikasi | Tidak seragam antar halaman |

Konsekuensi operasional yang dirasakan: perubahan data tidak langsung terlihat,
regenerasi cache memblokir, dan tidak ada satu sumber kebenaran untuk angka
availability.

---

## 2. Arsitektur sekarang

```
Jira WMO ──scrape──> issues.json ──> portal Express :4100 ──> /monitoring/*
WMO WDQMS API ──Celery──> TimescaleDB ──> FastAPI :8000 ──> Next.js :3000
landingpage (statis) ──> disajikan port 80
```

| Komponen | Isi | Stack | Port |
| --- | --- | --- | --- |
| `landingpage/` | Situs publik (beranda, activities, reports, training) | HTML + CSS + JS | 80 |
| `jira-ticket-v2/` | Portal monitoring tiket + laporan | Express + MySQL | 4100 |
| `wdqms-v2/apps/api` | API observasi, agregasi, dokumen | FastAPI + SQLAlchemy async | 8000 |
| `wdqms-v2/apps/web` | Dashboard WDQMS | Next.js 15 App Router | 3000 |

**Perubahan kunci dibanding v1:**

1. **TimescaleDB menggantikan file cache.** `observations_gbon` dan
   `observations_nwp` adalah hypertable; `daily_availability_gbon` dan
   `monthly_availability_gbon` adalah continuous aggregate. Query tren tahunan
   jadi satu query SQL, bukan regenerasi JSON.
2. **Celery Beat menggantikan cron.** Ingest harian 02:30 WIB (5 task,
   concurrency 1 agar sequential) dan backfill 05:00 WIB Senin–Sabtu.
3. **Agregasi pindah ke server.** Satu definisi availability dipakai chart,
   tabel, PDF, dan kartu landing.
4. **Portal tiket dipisah** ke aplikasi Express sendiri; landing mengambil
   ringkasan lewat `/api/wdqms-summary` (cache 5 menit).
5. **Routing dinestkan** di `/wdqms/*` agar mirip layout v1 dan URL lama tetap
   di-redirect.

---

## 3. Perubahan yang baru dikerjakan

### 3.1 Halaman analytics `/wdqms/reports`

Masalah sebelumnya: halaman menarik data stasiun mentah lalu menghitung
ringkasan di browser. Dua implementasi agregasi (client vs server) menghasilkan
angka berbeda, dan beberapa bug berulang berasal dari situ.

| Bug yang muncul | Akar masalah |
| --- | --- |
| NWP wilayah tampil 2,6% padahal portal 7,1% | `received` dijumlah lintas centre, `expected` tetap per centre |
| Tren tahunan menampilkan wilayah RWC Fiji | Endpoint yearly tidak memfilter territory |
| Upper-air memakai `variable=pressure` | State `variable` bocor lintas dataset |
| Null tampil sebagai `-%` | Fallback `?? "-"` hanya membungkus angka, bukan suffix |
| Chart kosong saat memuat | Tidak ada state loading, "No data" muncul lebih dulu |

**Perbaikan:**

- **`GET /api/v1/reports/snapshot`** — agregat per wilayah dihitung server:
  `territory_code`, `station_count`, `received_total`, `expected_total`,
  `availability_pct`. Chart batang membaca hasil ini; logika agregasi di client
  dihapus.
- **Definisi availability disamakan dengan portal:** rata-rata persentase per
  stasiun (centre terbaik untuk NWP), dibatasi 0–100. Angka PNG cocok: 7,1%.
  Rasio total/expected (3,0%) sengaja **tidak** dipakai karena menekan wilayah
  yang punya stasiun berjadwal besar tapi tidak melapor.
- **Filter territory** pada yearly (`ALL_COMBINED`) sehingga wilayah RWC lain
  tidak ikut.
- **Satu `effectiveVariable`** untuk snapshot, yearly, dan tautan PDF. Upper-air
  hanya punya `temperature`; NWP upper-air juga menolak `pressure` (422).
- **Format angka terpusat** (`formatPct`/`formatCount`): 1 desimal, `—` untuk
  null, `toLocaleString` untuk ribuan.
- **Loading state konsisten** di tiga chart (spinner, pesan gagal, pesan kosong).
- **Tab dataset sinkron ke URL** (`?dataset=`), bisa di-bookmark dan dibagikan.

### 3.2 Penggabungan wilayah USA Pacific

Enam wilayah (`LIH`, `HNL`, `OGG`, `ITO`, `GUM`, `PPG`) masing-masing hanya
punya satu stasiun GBON, sehingga chart dan legenda dipenuhi enam entri 66,7%.

- Bar chart dan tren tahunan kini menampilkan satu seri **US**.
- Tren tahunan: rata-rata berbobot per bulan; nilai historis dibatasi 0–100
  (data mentah bisa 369,5 untuk IDN Januari 2026).
- **Tabel stasiun dan API tetap memakai kode asli** — ini murni penggabungan
  tampilan.
- `TERRITORY_COLORS`: enam entri oranye identik diganti satu `US`.

### 3.3 Halaman `/reports` (dokumen PDF)

- Penyebab halaman kosong: `REPORTS_DIR` hanya berisi `.gitkeep`, sehingga
  `/api/v1/documents/index` mengembalikan `{"years":[]}`.
- 64 PDF (58 MB) dari `landingpage/assets/REPORT/` disalin ke
  `wdqms-v2/data/REPORT/` (di-gitignore, di-mount read-only ke
  `/app/data/REPORT`).
- Seksi tahun dibuat tertutup secara default, sama seperti produksi.
- PDF diverifikasi tersaji (`200 application/pdf`); path traversal → 404.

> **Catatan deployment:** folder ini harus diisi di setiap environment. Cara
> paling praktis: set `REPORTS_HOST_DIR=/path/ke/landingpage/assets/REPORT`
> di `.env` produksi. Selama folder kosong, halaman menampilkan
> "No reports available yet" — bukan error.

### 3.4 Landing page (`/`)

- Tombol **Open Dashboard** pada dua kartu platform disejajarkan
  (`width:100%` + `margin-top:auto`); sebelumnya selisih ~330 px karena kartu
  WDQMS punya blok statistik dan kartu Jira tidak.
- Kartu Jira diberi catatan akses ("Requires a monitoring account") karena
  tautannya mengarah ke `/monitoring/login`.

### 3.5 Halaman login portal tiket

- `/monitoring/admin-login` dan `/monitoring/login` didesain ulang menjadi
  split dua panel (brand + form) dengan identitas RWC, label selalu terlihat,
  toggle password ber-ARIA, `aria-live` untuk error, input di-escape.
- "Back to home" diarahkan ke `/` (sebelumnya ke `issues`, yang memantul ke
  login).
- Kontrak API tidak berubah: cookie httpOnly, redirect ke `admin`/`issues`.
- Bootstrap CSS dilepas dari kedua halaman.

### 3.6 Halaman `/activities`

- **Index:** strip ringkasan (jumlah capacity development, coordination
  meeting, hari pelatihan) + kartu kategori yang bisa diklik penuh dengan ikon
  dan CTA eksplisit.
- **Daftar:** accordion datar diganti **timeline per tahun** (rail, badge
  tahun, titik per kegiatan, kartu berisi tipe/tanggal/CTA).
- **Detail pelatihan:** meta grid berikon, tile "5 hari · 62 sesi · 24 materi",
  objectives & outcomes dua kolom, dan **agenda 5 hari lengkap** dari data
  terstruktur (`lib/activities-agenda.ts`) dengan unduhan PDF per sesi.
- Verifikasi: 24 berkas materi diperiksa, semua `200`.

> **Catatan deployment:** materi berada di `landingpage/assets/materi`
> (421 MB, git-ignored). Link memakai `MATERI_BASE`, dapat diubah lewat
> `NEXT_PUBLIC_MATERI_BASE_URL` (default `http://192.168.15.57/assets/materi`).

---

## 4. Peta endpoint yang dipakai sekarang

Ringkas; detail lengkap di [`wdqms-v2/docs/API.md`](wdqms-v2/docs/API.md).

| Dipakai oleh | Endpoint |
| --- | --- |
| Peta GBON | `GET /observations/gbon/{land-surface,upper-air}` |
| Peta NWP | `GET /observations/nwp/{land-surface,upper-air}` |
| Chart analytics | `GET /reports/snapshot`, `GET /reports/yearly` |
| Export PDF | `GET /reports/export/pdf` |
| Halaman `/reports` | `GET /documents/index`, `GET /documents/files/{path}` |
| Peta global | `GET /stations`, `GET /territories` |
| Kartu landing | `GET /api/wdqms-summary` (Express :4100, cache 5 menit) |
| Portal tiket | `POST /api/monitoring/login`, `GET /api/issues`, `GET /api/summary`, … |

Semua endpoint observasi/reports/stations/documents **publik** (tanpa auth).
Endpoint `admin/*` memerlukan JWT + role.

---

## 5. Konfigurasi penting

| Env | Fungsi | Default |
| --- | --- | --- |
| `RWC_JURISDICTION_CODES` | Resolusi `ALL_COMBINED` | 13 kode Indonesia |
| `REPORTS_DIR` | Folder index laporan di container | `data/REPORT` |
| `REPORTS_HOST_DIR` | Folder host yang di-mount | `./data/REPORT` |
| `WMO_API_TOKEN` | Token WMO (menaikkan kuota 100/IP/hari) | kosong |
| `NEXT_PUBLIC_API_BASE_URL` | Base API untuk web | `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_MATERI_BASE_URL` | Base materi pelatihan | `http://192.168.15.57/assets/materi` |
| `WDQMS_SUMMARY_TTL_MS` | TTL cache ringkasan landing | `300000` |
| `WDQMS_SUMMARY_LOOKBACK_DAYS` | Mundur maksimum saat cari data | `14` |

---

## 6. Database

| Tabel | Isi |
| --- | --- |
| `stations` | Metadata stasiun (WIGOS ID, territory, koordinat) |
| `territories` | Kode wilayah + region |
| `observations_gbon` | Hypertable observasi GBON |
| `observations_nwp` | Hypertable observasi NWP per centre |
| `observations_gcos` | Observasi GCOS ECV |
| `users`, `api_keys`, `audit_logs`, `alembic_version` | Auth & audit |

Continuous aggregate: `daily_availability_gbon`, `monthly_availability_gbon`.
Endpoint `/reports/yearly` dan `/reports/monthly` membaca
`monthly_availability_gbon`.

Ingest terjadwal **02:30 WIB** (harian, 5 task, dijalankan sequential agar ramah kuota WMO) dan backfill **05:00 WIB** Senin–Sabtu (jendela 30 hari dibagi 6 malam, ±100 request/malam).

---

## 7. Masih terbuka

| Item | Status |
| --- | --- |
| Rate limit & `X-API-Key` di endpoint publik | Middleware tersedia, belum dipasang |
| Angka statistik kartu **Jira** di landing | Butuh endpoint ringkasan publik di portal |
| Ekspor PDF/CSV ikut menggabungkan wilayah US | Belum — penggabungan baru di tampilan |
| Isi folder `data/REPORT` dan `assets/materi` di produksi | Data deployment, harus disiapkan per server |
| `variable` belum divalidasi ketat di `/reports/{yearly,monthly}` | Perbaikan kecil berikutnya |
