# One image serves the API and the web app (same origin, strict CSP). Build: docker build -t smart-gameya .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/financial-core/package.json packages/financial-core/
COPY packages/ai-core/package.json packages/ai-core/
RUN npm ci
COPY . .
RUN cd apps/web && npx vite build && cd ../api && npx tsc -p tsconfig.json

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/financial-core/package.json packages/financial-core/
COPY packages/ai-core/package.json packages/ai-core/
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/api/agreements apps/api/agreements
COPY infrastructure/database/migrations infrastructure/database/migrations
COPY scripts/migrate.mjs scripts/migrate.mjs
RUN mkdir -p /app/uploads && chown node:node /app/uploads
ENV UPLOAD_DIR=/app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh","-c","node scripts/migrate.mjs && node apps/api/dist/apps/api/src/main.js"]
