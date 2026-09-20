# Platform Monitoring Stasiun Cuaca (IoT)

Tes teknis Fullstack Developer — PT Luwes Inovasi Mandiri.

> Dokumen ini diisi bertahap seiring implementasi. Lihat juga:
> - [`JAWABAN.md`](JAWABAN.md) — soal esai + pertanyaan desain bagian A–G
> - [`docs/ERD.md`](docs/ERD.md) — entity relationship diagram
> - [`docs/DATA-FLOW.md`](docs/DATA-FLOW.md) — alur data sensor → chart
> - [`docs/API.md`](docs/API.md) — dokumentasi endpoint + contoh JSON

## Stack

| Layer | Pilihan | Alasan singkat |
|---|---|---|
| Backend | NestJS (Node.js 22, TypeScript) | Struktur modular, DI, validasi deklaratif, Swagger otomatis |
| Database | TimescaleDB (PostgreSQL 16 + extension) | Hypertable & continuous aggregate untuk beban time-series |
| ORM / migrasi | Prisma | Migrasi ter-versi; query time-series ditulis raw SQL |
| Frontend | Next.js (App Router) + Recharts | Wajib salah satu Next/Nuxt |
| Deployment | Docker + docker compose | Seluruh stack satu perintah |

## Menjalankan

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/docs |
| Health check | http://localhost:3001/healthz |

## Struktur repo

```
.
├── apps/
│   ├── api/            # Backend NestJS
│   └── web/            # Frontend Next.js
├── tools/
│   └── simulator/      # Device simulator (normal / offline-batch / duplikat)
├── docs/               # ERD, diagram alur data, dokumentasi API
└── docker-compose.yml
```

## Status pengerjaan

<!-- Diisi di akhir: apa yang selesai, apa yang belum, dan rencananya. -->
