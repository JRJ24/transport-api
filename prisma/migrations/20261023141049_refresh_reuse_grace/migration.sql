-- AlterTable
ALTER TABLE "AUTH"."user_sessions" ADD COLUMN     "previous_refresh_token_hash" TEXT,
ADD COLUMN     "refresh_rotated_at" TIMESTAMP(3);

