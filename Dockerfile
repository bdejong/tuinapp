FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM rust:1.99-bookworm AS backend
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY server ./server
RUN cargo build --locked --release --bin tuinapp-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 tuinapp && useradd --uid 10001 --gid tuinapp --no-create-home tuinapp \
    && mkdir -p /app/data /app/backups && chown -R tuinapp:tuinapp /app
WORKDIR /app
COPY --from=backend /app/target/release/tuinapp-server /usr/local/bin/tuinapp-server
COPY --from=frontend /app/dist ./dist
USER tuinapp
ENV TUINAPP_BIND=0.0.0.0:3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD curl --fail --silent http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["tuinapp-server"]
CMD ["serve"]
