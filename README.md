# RWC Indonesia — v2

Platform monitoring terintegrasi **Regional WIGOS Centre (RWC) Indonesia**,
dioperasikan BMKG bersama WMO. Repo ini berisi tiga komponen:

| Folder | Isi | Stack |
| --- | --- | --- |
| `landingpage/` | Situs publik RWC Indonesia (statis) | HTML + CSS + JS |
| `jira-ticket-v2/` | Portal monitoring tiket Jira WMO + laporan | Node.js (Express) + MySQL |
| `wdqms-v2/` | Dashboard WDQMS v2 (git submodule) | FastAPI + Next.js + TimescaleDB |

## Arsitektur

```
Jira WMO ──scrape──> issues.json ──> portal /monitoring (Express :4100)
WMO WDQMS API ──Celery──> TimescaleDB ──> FastAPI :8000 ──> Next.js :3000
landingpage ──static──> Express (disajikan dari root)
```

Portal tiket meneruskan `/wdqms/*` ke WDQMS v2 dan mengambil ringkasan
lewat `/api/wdqms-summary` (cache 5 menit).

## Menjalankan

### jira-ticket-v2

```bash
cd jira-ticket-v2
cp .env.example .env          # isi kredensial DB + JIRA_API_TOKEN
npm install --prefix server
node server/server.js         # default port 4100 (lihat PORT di .env)
```

Saat start, server membuat tabel `monitoring_user`/`country` bila belum ada,
lalu melakukan scraping Jira setiap 30 menit dan menulis `issues.json`.

### wdqms-v2

Ada di repo terpisah dan di-mount sebagai submodule. Setelah clone:

```bash
git submodule update --init --recursive
cd wdqms-v2
cp .env.example .env
docker compose up -d
docker compose exec api alembic upgrade head
```

Detail lengkap: [`wdqms-v2/README.md`](wdqms-v2/README.md) dan
[`wdqms-v2/docs/DEPLOY.md`](wdqms-v2/docs/DEPLOY.md).

## Aset yang tidak disertakan

Dua folder besar sengaja di-gitignore karena melebihi batas GitHub dan
di-deploy manual ke server (scp/rsync):

- `landingpage/assets/materi/` — materi training WIGOS (421 MB)
- `landingpage/assets/REPORT/` — laporan PDF 2024–2026 (58 MB)

`jira-ticket-v2/issues.json` juga diabaikan: itu snapshot hasil scraping
berisi data tiket operasional, dibuat ulang saat runtime.

## Kontak

Regional WIGOS Centre Indonesia — BMKG
[inarwc@bmkg.go.id](mailto:inarwc@bmkg.go.id)
