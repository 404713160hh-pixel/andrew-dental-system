FROM node:24.15.0-bookworm-slim AS application
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 DENTAL_DB_PATH=/var/lib/dental/dental.sqlite DENTAL_SEED_DEMO=0
COPY package.json ./
COPY server ./server
COPY public ./public
COPY tools ./tools
COPY docs ./docs
COPY *.md ./
RUN node tools/build-docs.mjs && mkdir -p /var/lib/dental /var/backups/dental && chown -R node:node /var/lib/dental /var/backups/dental
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.js"]
