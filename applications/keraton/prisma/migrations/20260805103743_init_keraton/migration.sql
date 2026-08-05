-- CreateEnum
CREATE TYPE "LocalSessionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "local_sessions" (
    "id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "external_user_id" UUID NOT NULL,
    "central_session_id" UUID NOT NULL,
    "status" "LocalSessionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "local_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_cache" (
    "external_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "groups" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_cache_pkey" PRIMARY KEY ("external_user_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "correlation_id" TEXT,
    "event" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_sessions_session_token_hash_key" ON "local_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "local_sessions_external_user_id_status_idx" ON "local_sessions"("external_user_id", "status");

-- CreateIndex
CREATE INDEX "local_sessions_central_session_id_status_idx" ON "local_sessions"("central_session_id", "status");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");
