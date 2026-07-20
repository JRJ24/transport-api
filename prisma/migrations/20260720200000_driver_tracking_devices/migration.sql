-- CreateEnum
CREATE TYPE "NOTIFICATIONS"."NOTIFICATION_STATUS" AS ENUM ('PENDING', 'SENT', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NOTIFICATIONS"."DEVICE_PLATFORM" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- AlterTable
ALTER TABLE "ORDERS"."order_stops" ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "ORDERS"."order_events" ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "longitude" DROP NOT NULL,
ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "DRIVERS"."driver_locations" ADD COLUMN     "altitude" DECIMAL(8,2),
ADD COLUMN     "client_id" TEXT,
ADD COLUMN     "heading" DECIMAL(6,2),
ADD COLUMN     "is_mocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sequence" INTEGER,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "vehicle_id" TEXT,
ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "accuracy" SET DATA TYPE DECIMAL(8,2),
ALTER COLUMN "speed" SET DATA TYPE DECIMAL(8,2);

-- AlterTable
ALTER TABLE "NOTIFICATIONS"."notifications" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "status" "NOTIFICATIONS"."NOTIFICATION_STATUS" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "NOTIFICATIONS"."device_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "NOTIFICATIONS"."DEVICE_PLATFORM" NOT NULL,
    "installation_id" TEXT NOT NULL,
    "device_name" TEXT,
    "app_version" TEXT,
    "locale" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "NOTIFICATIONS"."device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_is_active_idx" ON "NOTIFICATIONS"."device_tokens"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_user_id_installation_id_key" ON "NOTIFICATIONS"."device_tokens"("user_id", "installation_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "ORDERS"."order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "driver_locations_session_id_recorded_at_idx" ON "DRIVERS"."driver_locations"("session_id", "recorded_at");

-- CreateIndex
CREATE INDEX "driver_locations_order_id_recorded_at_idx" ON "DRIVERS"."driver_locations"("order_id", "recorded_at");

-- CreateIndex
CREATE INDEX "driver_locations_driver_id_recorded_at_idx" ON "DRIVERS"."driver_locations"("driver_id", "recorded_at");

-- CreateIndex
CREATE INDEX "driver_locations_vehicle_id_recorded_at_idx" ON "DRIVERS"."driver_locations"("vehicle_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_locations_session_id_client_id_key" ON "DRIVERS"."driver_locations"("session_id", "client_id");

-- CreateIndex
CREATE INDEX "tracking_sessions_order_id_status_idx" ON "TRACKING"."tracking_sessions"("order_id", "status");

-- CreateIndex
CREATE INDEX "tracking_sessions_driver_id_status_idx" ON "TRACKING"."tracking_sessions"("driver_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "NOTIFICATIONS"."notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "NOTIFICATIONS"."notifications"("status", "created_at");

-- AddForeignKey
ALTER TABLE "DRIVERS"."driver_locations" ADD CONSTRAINT "driver_locations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "TRACKING"."tracking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NOTIFICATIONS"."device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
