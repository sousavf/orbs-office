# Standalone Orbs Office relay. Build context is the repository root (it needs only shared/ and relay-server/):
#   docker build -f relay-server/Dockerfile -t orbs-office-relay .
FROM oven/bun:1.4.2-slim AS build
WORKDIR /src
COPY shared ./shared
COPY relay-server ./relay-server
# One self-contained file: no node_modules and no source in the final image.
RUN bun build relay-server/index.ts --target bun --minify --outfile /out/relay.js

FROM oven/bun:1.4.2-slim
ENV HOST=0.0.0.0 \
    PORT=8790 \
    DATA_DIR=/data \
    NODE_ENV=production
# The data directory belongs to the unprivileged `bun` user; a named volume mounted here inherits that ownership.
RUN mkdir -p /data && chown bun:bun /data
WORKDIR /app
COPY --from=build --chown=bun:bun /out/relay.js ./relay.js
USER bun
EXPOSE 8790
VOLUME ["/data"]
# Binding 0.0.0.0 is for the container's own network namespace; compose publishes it on 127.0.0.1 only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT ?? '8790') + '/healthz'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "relay.js"]
