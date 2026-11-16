# Alur Data Masuk Sistem — WDQMS Monitoring

Dokumen ini menjelaskan bagaimana data observasi cuaca dari **WMO WDQMS (WIGOS Data Quality Monitoring System)** masuk, diproses, di-*cache*, dan disajikan di dashboard RWC Indonesia.

---

## 1. Ringkasan Sistem

WDQMS Monitoring adalah modul berbasis **PHP** (`/wdqms`) yang menampilkan ketersediaan (*availability*) data observasi stasiun terhadap pusat NWP global (DWD, ECMWF, JMA, NCEP).

| Komponen | Teknologi | Lokasi |
|----------|-----------|--------|
| Sumber data | WMO WDQMS API | `https://wdqms.wmo.int/wdqmsapi/v1/...` |
| Sinkronisasi data | Node.js | `scripts/sync_wmo_data.js` |
| API endpoint | PHP | `wdqms/api/*.php` |
| Caching layer | PHP file cache | `wdqms/cache/api_responses/` |
| Pre-warm cache | PHP CLI + cron | `wdqms/api/cache_prewarm.php` |
| Frontend | HTML/JS | `wdqms/*.php`, `wdqms/reports/` |

---

## 2. Sumber Data

Data diambil dari WMO WDQMS API dengan parameter:

- **Period**: `six_hour`, `daily`, `monthly`
- **Time period**: `00`, `06`, `12`, `18` (UTC synoptic hours)
- **Variable**: `pressure`, `temperature`, `zonal_wind`, `meridional_wind`, `humidity`
- **Centers**: `DWD, ECMWF, JMA, NCEP`
- **Territory**: `ALL_COMBINED`, `IDN`, `MYS`, `SGP`, `PHL`, `BRN`, `TLS`, `PNG`, `USA_PACIFIC`

Contoh URL request:

```
https://wdqms.wmo.int/wdqmsapi/v1/download/gbon/synop/{period}/availability/
    ?date={date}&period={time_period}&variable={variable}&centers=DWD,ECMWF,JMA,NCEP
```

---

## 3. Diagram Alur Data Utama

```mermaid
flowchart TD
    A[WMO WDQMS API<br/>wdqms.wmo.int] -->|HTTP GET| B{Jalur Masuk Data}

    B -->|Sinkronisasi terjadwal| C[sync_wmo_data.js<br/>Node.js]
    B -->|Permintaan real-time| D[API PHP<br/>gbon_land_surface_stations.php<br/>gbon_upper_air_stations.php]

    C -->|Simpan JSON mentah| E[(wdqms_data/<br/>file JSON lokal)]

    D --> F[cache_wrapper.php]
    F -->|Cek cache| G{Cache ada?}
    G -->|HIT| H[Serve dari cache<br/>X-Cache: HIT]
    G -->|MISS| I[Olah data + ambil dari WMO]
    I -->|Simpan hasil| J[(wdqms/cache/<br/>api_responses/*.json)]
    I --> K[Output JSON]
    H --> L[Frontend Dashboard]
    K --> L

    L --> M[Grafik &amp; Tabel<br/>Availability per stasiun]

    style A fill:#4A90D9,color:#fff
    style F fill:#F5A623,color:#fff
    style J fill:#7ED321,color:#000
    style L fill:#BD10E0,color:#fff
```

---

## 4. Mekanisme Caching

`cache_wrapper.php` di-*include* di bagian atas setiap endpoint API. Alurnya:

```mermaid
sequenceDiagram
    participant U as User/Frontend
    participant W as cache_wrapper.php
    participant FS as File Cache
    participant API as Logic API PHP
    participant WMO as WMO WDQMS API

    U->>W: Request (date, variable, territory)
    W->>W: Generate cache key (md5 query params)
    W->>FS: Cek file cache

    alt Cache HIT
        FS-->>W: File cache ditemukan
        W->>W: Validasi (cek duplikat WIGOS ID)
        W-->>U: JSON + header X-Cache: HIT
    else Cache MISS
        W->>API: Jalankan logic asli (ob_start)
        API->>WMO: Ambil data observasi
        WMO-->>API: Data availability
        API-->>W: Output JSON (buffer)
        W->>FS: Simpan ke cache (jika valid)
        W-->>U: JSON + header X-Cache: MISS
    end
```

Karakteristik cache:
- **Permanen** (tidak expired otomatis) — di-*refresh* lewat pre-warm.
- **Cache key** = nama_script + `md5(query_params terurut)`.
- Hanya respons JSON valid dengan field `stations` (tanpa `error`) yang di-cache.
- Cache yang mengandung **duplikat WIGOS ID** otomatis dihapus.

---

## 5. Pre-warming Cache (Terjadwal)

`cache_prewarm.php` dijalankan via cron/Task Scheduler (mis. tiap 30 menit) untuk mengisi cache semua kombinasi parameter, sehingga semua user mendapat *loading* instan.

```mermaid
flowchart LR
    CRON[Cron / Task Scheduler<br/>tiap 30 menit] --> PW[cache_prewarm.php]
    PW --> LOOP{Loop semua kombinasi}
    LOOP -->|territory x variable<br/>x time_period x date| REQ[Request ke endpoint API]
    REQ --> WMO[WMO WDQMS API]
    WMO --> CACHE[(Cache terisi)]
    CACHE --> READY[Dashboard siap<br/>respons cepat]

    style CRON fill:#50E3C2,color:#000
    style CACHE fill:#7ED321,color:#000
    style READY fill:#BD10E0,color:#fff
```

Default tanggal pre-warm: **2 hari sebelum hari ini** (mengikuti keterlambatan publikasi data WMO).

---

## 6. Penyajian di Dashboard

Data availability yang sudah diolah disajikan sebagai:
- **Tabel stasiun** dengan status ketersediaan per variabel.
- **Time series** ketersediaan (`*_timeseries.php`).
- **Laporan tahunan** (`*_yearly*.php`) dengan cache terpisah.
- **Grafik** perbandingan antar pusat NWP.

---

## 7. Ringkasan End-to-End

```mermaid
flowchart TD
    subgraph Sumber
        WMO[WMO WDQMS API]
    end
    subgraph Backend_PHP
        SYNC[sync_wmo_data.js]
        APIPHP[API Endpoints PHP]
        WRAP[cache_wrapper.php]
        PREWARM[cache_prewarm.php]
        CACHE[(File Cache)]
    end
    subgraph Frontend
        DASH[Dashboard WDQMS]
        CHART[Grafik &amp; Tabel Availability]
    end

    WMO --> SYNC
    WMO --> APIPHP
    PREWARM --> APIPHP
    APIPHP --> WRAP
    WRAP --> CACHE
    CACHE --> DASH
    DASH --> CHART

    style WMO fill:#4A90D9,color:#fff
    style CACHE fill:#7ED321,color:#000
    style CHART fill:#BD10E0,color:#fff
```

---

*Dokumen dibuat berdasarkan analisis kode: `scripts/sync_wmo_data.js`, `wdqms/api/cache_wrapper.php`, `wdqms/api/cache_prewarm.php`, dan `wdqms/config/config.php`.*
