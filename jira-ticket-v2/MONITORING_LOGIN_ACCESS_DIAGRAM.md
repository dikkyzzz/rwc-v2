# Monitoring Login Access Diagram

Dokumen ini menjelaskan alur login dan kontrol akses pada modul monitoring Jira RWC Indonesia.

## 1. Authentication Flow

```mermaid
flowchart TD
    A[User membuka /monitoring/index.html] --> B{Sudah punya cookie monitoring_session?}
    B -- Tidak --> C[Redirect ke /monitoring/monitoring-login.html]
    B -- Ya --> D[monitoringPageAuth cek session]
    D -- Session valid --> E[Halaman monitoring dibuka]
    D -- Session tidak valid/expired --> C

    C --> F[User isi Email Address + Password]
    F --> G[POST /api/monitoring/login]
    G --> H[Query tabel monitoring_user]
    H --> I{User ada, aktif, password benar?}
    I -- Tidak --> J[401 Login gagal]
    I -- Ya --> K[Buat token session]
    K --> L[Simpan ke monitoringSessions]
    L --> M[Set cookie HttpOnly: monitoring_session]
    M --> N[Response user profile]
    N --> O[Browser akses ulang halaman monitoring]
    O --> D
```

## 2. Authorization Flow

```mermaid
flowchart TD
    A[Request ke API monitoring] --> B[authenticateMonitoring]
    B --> C{Session valid?}
    C -- Tidak --> D[401 Monitoring session tidak valid]
    C -- Ya --> E[Ambil req.monitoringUser]
    E --> F{Role = admin/super_admin?}

    F -- Ya --> G[Full access]
    G --> H[Semua issue dikirim]
    G --> I[Semua country dikirim]
    G --> J[Semua statistik dikirim]

    F -- Tidak --> K{Role = user dan punya access_country_name?}
    K -- Tidak --> D
    K -- Ya --> L[Country-only access]
    L --> M[Issue difilter berdasarkan negara user]
    L --> N[Country list difilter ke negara user]
    L --> O[Chart/statistik hanya dari negara user]
```

## 3. Issue Filtering Logic

```mermaid
flowchart LR
    A[issues.json] --> B[readIssuesData]
    C[tabel country] --> D[buildCountryMatchers]
    B --> E[filterIssuesForMonitoringUser]
    D --> E
    F[monitoringUser.access_country_name] --> E
    E --> G{Admin / Super Admin?}
    G -- Ya --> H[Return semua issues]
    G -- Tidak --> I[Ambil negara dari issue.summary]
    I --> J{Negara issue == negara user?}
    J -- Ya --> K[Issue ikut tampil]
    J -- Tidak --> L[Issue disembunyikan]
```

## 4. Role Matrix

| Role | Akses Halaman Monitoring | Akses Semua Negara | Akses Negara Tertentu | Kelola User |
| --- | --- | --- | --- | --- |
| `super_admin` | Ya | Ya | Ya | Ya |
| `admin` | Ya | Ya | Ya | Tidak |
| `user` | Ya | Tidak | Ya, sesuai `access_country_name` | Tidak |

## 5. Session Characteristics

- Session monitoring disimpan di memory server (`monitoringSessions`), bukan Redis/database session store.
- Masa berlaku session: 24 jam.
- Cookie yang dipakai: `monitoring_session`.
- Cookie diset sebagai `HttpOnly` dan `SameSite=Lax`.
- Jika service restart, semua session monitoring akan hilang dan user harus login ulang.

## 6. User Provisioning

```mermaid
flowchart TD
    A[Server start] --> B[initializeMonitoringUsers]
    B --> C[Pastikan tabel monitoring_user ada]
    C --> D[Seed privileged users]
    D --> E[superadmin@rwc.local]
    D --> F[rwc.indonesia@rwc.local]
    D --> G[wmo.secretariat@rwc.local]
    D --> H[wmo.centre@rwc.local]
    C --> I[Ambil daftar negara dari tabel country]
    I --> J[Buat akun NFP per negara]
    J --> K[Format: nfp.slug-negara@rwc.local]
    J --> L[Role: user]
    J --> M[access_country_name + access_country_code diisi]
```

## 7. Endpoint Mapping

- Login monitoring: `POST /api/monitoring/login`
- Cek session monitoring: `GET /api/monitoring/session`
- Logout monitoring: `POST /api/monitoring/logout`
- Issue list: `GET /api/issues`
- Summary ticket: `GET /api/summary`
- Country filter list: `GET /api/countries`
- Country statistics: `GET /api/stats/countries`
- Country + status statistics: `GET /api/stats/countries-status`

## 8. Source References

Implementasi utama ada di:

- `server/server.js`
  - session + cookie monitoring
  - login/logout monitoring
  - middleware proteksi halaman monitoring
  - filter akses `full access` vs `country-only`
  - seed user monitoring

