#!/bin/sh
# Dijalankan setiap kali container api start.
#
# Urutannya penting: migrasi harus selesai sebelum proses API menerima request
# pertama, dan seeder harus idempoten karena entrypoint ini ikut berjalan lagi
# pada setiap "docker compose restart".
set -e

echo "==> Menjalankan migrasi database..."
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma

echo "==> Menjalankan seeder (idempoten, aman diulang)..."
npm run seed --workspace=apps/api

echo "==> Menjalankan API..."
exec node apps/api/dist/main.js
