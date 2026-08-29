# Node 22+ runs TypeScript directly, so there is no build step and no compiled
# output to drift out of sync with the source.
FROM node:22-alpine

# curl is here for the container healthcheck below, nothing else.
RUN apk add --no-cache curl

WORKDIR /app

RUN corepack enable

# Dependencies first so a code change does not invalidate the install layer.
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY . .

# Never run the keeper as root; it holds a hot key.
USER node

ENV HEALTH_PORT=8080
EXPOSE 8080

# Docker restarts the container when this fails, which covers the case the
# process is alive but has stopped ticking. /health returns 503 once the last
# clean tick is older than HEALTH_STALE_AFTER_MS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "relayer.ts"]
