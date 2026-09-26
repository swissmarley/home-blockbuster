# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# ffmpeg: transcoding, thumbnails and stream probing. tini: clean signal handling.
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8585 \
    DATA_DIR=/data \
    MEDIA_ROOTS=/media
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 8585
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
