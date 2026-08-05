# One Dockerfile for all six Node services, selected by the SERVICE build arg.
# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG SERVICE
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY auth-provider ./auth-provider
COPY applications ./applications
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm -r run generate
RUN pnpm -r build
RUN pnpm --filter "${SERVICE}" deploy --prod --legacy /out

FROM base AS runtime
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
CMD ["node", "dist/main.js"]
