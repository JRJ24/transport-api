-- AlterTable
ALTER TABLE "AUTH"."users" ALTER COLUMN "last_login_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AUTH"."user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_id" TEXT,
    "device_name" TEXT,
    "platform" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "AUTH"."user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "AUTH"."user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "user_sessions_revoked_at_idx" ON "AUTH"."user_sessions"("revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_device_id_idx" ON "AUTH"."user_sessions"("device_id");

-- AddForeignKey
ALTER TABLE "AUTH"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
