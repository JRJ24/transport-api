ALTER TYPE "PAIDS"."PAYMENT_METHOD" ADD VALUE IF NOT EXISTS 'CHECK';
ALTER TYPE "PAIDS"."PAYMENT_METHOD" ADD VALUE IF NOT EXISTS 'CORPORATE_CREDIT';

DO $$ BEGIN
  CREATE TYPE "CUSTOMER"."CREDIT_ACCOUNT_STATUS" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PAIDS"."CHECK_STATUS" AS ENUM ('RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CUSTOMER"."customer_credit_accounts" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "credit_limit" DECIMAL(65,30) NOT NULL,
  "balance_used" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "credit_days" INTEGER NOT NULL DEFAULT 15,
  "status" "CUSTOMER"."CREDIT_ACCOUNT_STATUS" NOT NULL DEFAULT 'PENDING',
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_credit_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_credit_accounts_customer_id_key"
  ON "CUSTOMER"."customer_credit_accounts"("customer_id");

CREATE INDEX IF NOT EXISTS "customer_credit_accounts_status_idx"
  ON "CUSTOMER"."customer_credit_accounts"("status");

DO $$ BEGIN
  ALTER TABLE "CUSTOMER"."customer_credit_accounts"
    ADD CONSTRAINT "customer_credit_accounts_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "CUSTOMER"."customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PAIDS"."payments"
  ADD COLUMN IF NOT EXISTS "check_status" "PAIDS"."CHECK_STATUS",
  ADD COLUMN IF NOT EXISTS "dispatch_authorized_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispatch_authorized_by" TEXT;
