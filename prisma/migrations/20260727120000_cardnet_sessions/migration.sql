ALTER TYPE "PAIDS"."PAYMENT_STATUS" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "PAIDS"."PAYMENT_STATUS" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PAIDS"."PAYMENT_STATUS" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "CUSTOMER"."customer_addresses"
  ADD COLUMN IF NOT EXISTS "country_code" TEXT,
  ADD COLUMN IF NOT EXISTS "postal_code" TEXT;

ALTER TABLE "PAIDS"."payments"
  ADD COLUMN IF NOT EXISTS "transaction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_session_key" TEXT,
  ADD COLUMN IF NOT EXISTS "response_code" TEXT,
  ADD COLUMN IF NOT EXISTS "remote_response_code" TEXT,
  ADD COLUMN IF NOT EXISTS "authorization_code" TEXT,
  ADD COLUMN IF NOT EXISTS "retrieval_reference_number" TEXT,
  ADD COLUMN IF NOT EXISTS "transaction_token" TEXT,
  ADD COLUMN IF NOT EXISTS "masked_card_number" TEXT,
  ADD COLUMN IF NOT EXISTS "session_created_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_session_id_key"
  ON "PAIDS"."payments"("provider_session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "payments_payment_provider_transaction_id_key"
  ON "PAIDS"."payments"("payment_provider", "transaction_id");

CREATE INDEX IF NOT EXISTS "payments_order_id_idx"
  ON "PAIDS"."payments"("order_id");

CREATE INDEX IF NOT EXISTS "payments_status_created_at_idx"
  ON "PAIDS"."payments"("status", "created_at");
