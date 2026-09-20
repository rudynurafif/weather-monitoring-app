# Build context = root repo (lihat docker-compose.yml), karena ini monorepo
# npm workspaces dan package-lock.json berada di root.
FROM node:22-alpine

# Prisma engine membutuhkan openssl pada image alpine.
RUN apk add --no-cache openssl

WORKDIR /app

# Manifest disalin lebih dulu dan terpisah dari source code, supaya layer
# "npm ci" hanya dibangun ulang ketika dependensi berubah, bukan setiap kali
# ada perubahan satu baris kode.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/simulator/package.json tools/simulator/

RUN npm ci

COPY apps/api apps/api
COPY tools/simulator tools/simulator

# devDependencies sengaja TIDAK dibuang: prisma CLI dipakai untuk
# "migrate deploy" dan tsx dipakai menjalankan seeder saat container start.
RUN npm run build --workspace=apps/api

COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV TZ=UTC
EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
