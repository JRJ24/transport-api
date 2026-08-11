ALTER TYPE "CUSTOMER"."CREDIT_ACCOUNT_STATUS" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "CUSTOMER"."CREDIT_ACCOUNT_STATUS" ADD VALUE IF NOT EXISTS 'CLOSED';

CREATE UNIQUE INDEX IF NOT EXISTS "customer_profile_user_id_key"
  ON "CUSTOMER"."customer_profile"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "customer_profile_document_type_document_number_key"
  ON "CUSTOMER"."customer_profile"("document_type", "document_number");

CREATE TABLE IF NOT EXISTS "CUSTOMER"."customer_credit_movements" (
  "id" TEXT NOT NULL,
  "credit_account_id" TEXT NOT NULL,
  "order_id" TEXT,
  "payment_id" TEXT,
  "movement_type" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "balance_after" DECIMAL(65,30) NOT NULL,
  "notes" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_credit_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customer_credit_movements_credit_account_id_created_at_idx"
  ON "CUSTOMER"."customer_credit_movements"("credit_account_id", "created_at");

CREATE INDEX IF NOT EXISTS "customer_credit_movements_order_id_idx"
  ON "CUSTOMER"."customer_credit_movements"("order_id");

CREATE INDEX IF NOT EXISTS "customer_credit_movements_payment_id_idx"
  ON "CUSTOMER"."customer_credit_movements"("payment_id");

DO $$ BEGIN
  ALTER TABLE "CUSTOMER"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_credit_account_id_fkey"
    FOREIGN KEY ("credit_account_id") REFERENCES "CUSTOMER"."customer_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CUSTOMER"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CUSTOMER"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "PAIDS"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
