# Alur Data Masuk Sistem — Jira Monitoring

Dokumen ini menjelaskan bagaimana data tiket/issue dari **Jira WMO** masuk ke sistem RWC Indonesia melalui *scraping*, disimpan, dan disajikan di dashboard monitoring.

---

## 1. Ringkasan Sistem

Jira Monitoring adalah modul berbasis **Node.js** (`/server`) yang mengambil data issue yang dilaporkan oleh "RWC Indonesia" di Jira WMO, lalu menyajikannya sebagai laporan dan statistik.

| Komponen | Teknologi | Lokasi |
|----------|-----------|--------|
| Sumber data | Jira WMO | `https://jira.wmo.int` |
| Jira client | Node.js + REST API v2 (Personal Access Token) | `server/jira-client.js` |
| Penyimpanan issue | File JSON | `issues.json` |
| Database referensi | MySQL | DB `jira`, tabel `country` |
| Web server / API | Node.js (Express) | `server/server.js` |
| Frontend | HTML/JS | `public/`, `server/public/` |

---

## 2. Sumber Data

`jira-client.js` memanggil **Jira REST API v2** dengan Personal Access Token, lalu menjalankan query JQL:

```
reporter in ("RWC Indonesia") ORDER BY created DESC
```

Data diambil dengan **paginasi** (5 halaman × 50 issue) dari URL:

```
https://jira.wmo.int/issues/?jql={JQL}&startIndex={0,50,100,...}
```

Field yang di-*scrape* per issue:
- `key`, `summary`, `status`, `assignee`, `reporter`
- `priority`, `created`, `updated`
- `description`, `wigosIssueCategory`, `wigosId`

---

## 3. Diagram Alur Data Utama

```mermaid
flowchart TD
    A[Jira WMO<br/>jira.wmo.int] -->|REST API v2 + PAT| B[jira-client.js]

    B -->|Muat cookie| C{Cookie valid?}
    C -->|Ya| D[Lewati login]
    C -->|Tidak| E[Login dgn kredensial<br/>maks 3x percobaan]

    D --> F[Query JQL:<br/>reporter = RWC Indonesia]
    E --> F

    F -->|Paginasi 5 halaman x 50| G[Scrape baris issue<br/>page.evaluate]
    G --> H{Ada issue baru?}
    H -->|Ya| I[Kumpulkan issue]
    H -->|Tidak| J[Berhenti scraping]
    I --> K{Total issue > 0?}

    K -->|Ya| L[(issues.json<br/>ditimpa)]
    K -->|Tidak & file lama ada| M[Pertahankan data lama<br/>safety guard]

    L --> N[server.js / Express]
    N --> O[Frontend Dashboard<br/>report.html, stats.html]
    O --> P[Grafik &amp; Statistik Issue]

    style A fill:#0052CC,color:#fff
    style B fill:#F5A623,color:#fff
    style L fill:#7ED321,color:#000
    style P fill:#BD10E0,color:#fff
```

---

## 4. Siklus Scraping Terjadwal

Scraper berjalan otomatis dengan `setInterval` (default tiap 30 menit) dan dijaga oleh proses manager (PM2). *Flag* `isScraping` mencegah eksekusi ganda.

```mermaid
sequenceDiagram
    participant T as Timer (setInterval 30 min)
    participant S as jira-client.js
    participant L as Lock (isScraping)
    participant J as Jira WMO
    participant F as issues.json
    participant LOG as logs/scrape.log

    T->>S: Trigger scrapeIssues()
    S->>L: Cek flag isScraping

    alt Sedang berjalan
        L-->>S: true
        S->>LOG: "Scraping sedang berjalan, skip"
    else Idle
        L-->>S: false (set true)
        S->>J: GET /rest/api/2/search (Bearer PAT)
        J-->>S: HTML hasil pencarian
        S->>S: Parse baris issue (5 halaman)
        alt Total issue > 0
            S->>F: Tulis ulang issues.json
            S->>LOG: "Total N issue disimpan"
        else 0 issue & file lama ada
            S->>LOG: "Pertahankan data lama"
        end
        S->>L: set isScraping = false
        S->>LOG: "Scraping selesai"
    end
```

---

## 5. Mekanisme Keamanan & Ketahanan Data

```mermaid
flowchart LR
    subgraph Ketahanan
        R1[Retry login<br/>maks 3x]
        R2[Retry muat halaman<br/>maks 3x per halaman]
        R3[Lock isScraping<br/>cegah race condition]
        R4[Safety guard<br/>tidak timpa dgn 0 issue]
    end

    SCRAPE[jira-client.js] --> R1
    SCRAPE --> R2
    SCRAPE --> R3
    SCRAPE --> R4

    style SCRAPE fill:#F5A623,color:#fff
    style R4 fill:#7ED321,color:#000
```

> **Catatan keamanan:** Scraper memakai Personal Access Token Jira dari environment variable `JIRA_API_TOKEN` (header `Authorization: Bearer`). Login SSO dengan username/password sudah tidak dipakai. Token disimpan di `.env` yang di-*gitignore* dan sebaiknya dirotasi berkala.

---

## 6. Penyimpanan & Penyajian

- **`issues.json`** — sumber utama data issue yang dibaca oleh `server.js`.
- **MySQL DB `jira`** — tabel `country` sebagai referensi pemetaan negara (Brunei, Indonesia, Malaysia, PNG, Philippines, Singapore, Timor-Leste, US).
- **Frontend** menyajikan: daftar issue, statistik per status (OPEN/CLOSED), kategori WIGOS, distribusi per negara, dan grafik.

```mermaid
flowchart TD
    JSON[(issues.json)] --> SRV[server.js / Express]
    MYSQL[(MySQL: tabel country)] --> SRV
    SRV --> API[REST API /api/...]
    API --> RPT[report.html]
    API --> STAT[stats.html]
    RPT --> CHART1[Grafik per Status]
    STAT --> CHART2[Grafik per Negara &amp;<br/>Kategori WIGOS]

    style JSON fill:#7ED321,color:#000
    style MYSQL fill:#00758F,color:#fff
    style CHART1 fill:#BD10E0,color:#fff
    style CHART2 fill:#BD10E0,color:#fff
```

---

## 7. Ringkasan End-to-End

```mermaid
flowchart TD
    subgraph Sumber
        JIRA[Jira WMO]
    end
    subgraph Backend_Node
        SCRAPE[jira-client.js]
        JSON[(issues.json)]
        SRV[server.js Express]
        DB[(MySQL country)]
    end
    subgraph Frontend
        DASH[Dashboard Monitoring]
        CHART[Grafik &amp; Statistik]
    end

    JIRA -->|REST API v2 + JQL| SCRAPE
    SCRAPE --> JSON
    JSON --> SRV
    DB --> SRV
    SRV --> DASH
    DASH --> CHART

    style JIRA fill:#0052CC,color:#fff
    style JSON fill:#7ED321,color:#000
    style CHART fill:#BD10E0,color:#fff
```

---

*Dokumen dibuat berdasarkan analisis kode: `server/jira-client.js`, `server/config/database.js`, `jira.sql`, dan `issues.json`.*
