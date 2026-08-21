# One Dockerfile for every Node service, selected by the SERVICE_PATH build arg.
# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY auth-provider ./auth-provider
COPY applications ./applications
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://placeholder@localhost:5432/placeholder \
    pnpm -r run generate
RUN pnpm -r build

FROM base AS runtime
ARG SERVICE_PATH
ENV SERVICE_PATH=${SERVICE_PATH}
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
CMD exec node ${SERVICE_PATH}/dist/main.js
