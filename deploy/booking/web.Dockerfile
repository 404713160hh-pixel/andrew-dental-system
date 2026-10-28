FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/package.json
COPY booking-api/package.json booking-api/package.json
COPY admin-web/package.json admin-web/package.json
COPY miniprogram/package.json miniprogram/package.json
RUN npm ci --ignore-scripts
COPY shared shared
COPY admin-web admin-web
RUN npm run build -w @andrew/admin-web
FROM nginx:1.28-alpine
COPY --from=build /app/admin-web/dist /usr/share/nginx/html
COPY deploy/booking/nginx.local.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
