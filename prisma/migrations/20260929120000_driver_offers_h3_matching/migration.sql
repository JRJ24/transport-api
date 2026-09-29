-- H3 driver matching: dispatch offers and one-active-assignment guards.

DO $$ BEGIN
  CREATE TYPE "ORDERS"."OFFER_STATUS" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ORDERS"."OFFER_MODE" AS ENUM ('MANUAL', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ORDERS"."driver_offers" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "driver_id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "score" DECIMAL(6,4),
  "eta_seconds" INTEGER,
  "score_version" TEXT NOT NULL,
  "mode" "ORDERS"."OFFER_MODE" NOT NULL,
  "status" "ORDERS"."OFFER_STATUS" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "actor_user_id" TEXT,
  "reason" TEXT,
  "snapshot" JSONB,
  "assignment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "driver_offers_order_id_status_idx"
  ON "ORDERS"."driver_offers"("order_id", "status");

CREATE INDEX IF NOT EXISTS "driver_offers_driver_id_created_at_idx"
  ON "ORDERS"."driver_offers"("driver_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "ORDERS"."driver_offers"
    ADD CONSTRAINT "driver_offers_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ORDERS"."driver_offers"
    ADD CONSTRAINT "driver_offers_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "DRIVERS"."driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- At most one open offer per order: two drivers can never hold the same
-- order at once, whatever the application does.
CREATE UNIQUE INDEX IF NOT EXISTS "driver_offers_one_pending_per_order"
  ON "ORDERS"."driver_offers"("order_id")
  WHERE "status" = 'PENDING';

-- At most one live assignment per order. Historic data may already break
-- this, so the index is only created when it would not fail; otherwise the
-- duplicates must be cleaned up and this block re-run by hand.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ORDERS"."order_assignments"
    WHERE "assignment_status" IN ('PENDING', 'ACCEPTED')
    GROUP BY "order_id"
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "order_assignments_one_active_per_order"
      ON "ORDERS"."order_assignments"("order_id")
      WHERE "assignment_status" IN ('PENDING', 'ACCEPTED');
  ELSE
    RAISE NOTICE 'order_assignments has orders with several active assignments; one-active index NOT created';
  END IF;
END $$;
