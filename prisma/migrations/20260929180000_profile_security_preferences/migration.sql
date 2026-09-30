-- Customer profile: avatar, notification preferences, verified email changes.

ALTER TABLE "AUTH"."users" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;

CREATE TABLE IF NOT EXISTS "NOTIFICATIONS"."notification_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "category" "NOTIFICATIONS"."NOTIFICATION_TYPE" NOT NULL,
  "push" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_category_key"
  ON "NOTIFICATIONS"."notification_preferences"("user_id", "category");

DO $$ BEGIN
  ALTER TABLE "NOTIFICATIONS"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AUTH"."email_change_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "new_email" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_change_requests_user_id_created_at_idx"
  ON "AUTH"."email_change_requests"("user_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "AUTH"."email_change_requests"
    ADD CONSTRAINT "email_change_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
