FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/package.json
COPY booking-api/package.json booking-api/package.json
COPY admin-web/package.json admin-web/package.json
COPY miniprogram/package.json miniprogram/package.json
RUN npm ci --ignore-scripts
COPY shared shared
COPY booking-api booking-api
RUN npm run build -w @andrew/booking-api

FROM node:24-bookworm-slim
ENV NODE_ENV=production BOOKING_HOST=0.0.0.0 BOOKING_PORT=3310
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/package.json
COPY booking-api/package.json booking-api/package.json
COPY admin-web/package.json admin-web/package.json
COPY miniprogram/package.json miniprogram/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@andrew/booking-api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/booking-api/dist booking-api/dist
COPY database database
USER node
EXPOSE 3310
CMD ["node","booking-api/dist/booking-api/src/main.js"]
