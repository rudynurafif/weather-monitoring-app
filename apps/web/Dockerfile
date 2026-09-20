# Build context = root repo (monorepo npm workspaces).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/simulator/package.json tools/simulator/

RUN npm ci

COPY apps/web apps/web

# Next.js membekukan NEXT_PUBLIC_* pada saat build (bukan saat run), sehingga
# nilainya harus tersedia di sini sebagai build arg, bukan sekadar env runtime.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ARG NEXT_PUBLIC_DISPLAY_TZ=Asia/Jakarta
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_DISPLAY_TZ=$NEXT_PUBLIC_DISPLAY_TZ

RUN npm run build --workspace=apps/web

ENV NODE_ENV=production
ENV TZ=UTC
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=apps/web"]
