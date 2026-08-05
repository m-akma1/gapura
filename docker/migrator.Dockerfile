ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION}
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY auth-provider ./auth-provider
COPY applications ./applications
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://placeholder@localhost:5432/placeholder \
    pnpm -r run generate
RUN pnpm -r build

COPY docker/migrate-all.sh /usr/local/bin/migrate-all
RUN chmod +x /usr/local/bin/migrate-all

CMD ["migrate-all"]
