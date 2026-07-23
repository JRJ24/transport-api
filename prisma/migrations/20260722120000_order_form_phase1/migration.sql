-- Phase 1 order-form support: draft orders, optional coordinates and territorial catalogs.

ALTER TABLE "CUSTOMER"."customer_addresses" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "CUSTOMER"."customer_addresses" ALTER COLUMN "longitude" DROP NOT NULL;

ALTER TABLE "ORDERS"."order_stops" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "ORDERS"."order_stops" ALTER COLUMN "longitude" DROP NOT NULL;

ALTER TABLE "ORDERS"."TransportOrders" ALTER COLUMN "quotes_id" DROP NOT NULL;
ALTER TABLE "ORDERS"."TransportOrders" ALTER COLUMN "distance_km" DROP NOT NULL;
ALTER TABLE "ORDERS"."TransportOrders" ALTER COLUMN "estimated_duration_min" DROP NOT NULL;
ALTER TABLE "ORDERS"."TransportOrders" ALTER COLUMN "total_amout" DROP NOT NULL;

CREATE TABLE "ADMINISTRATION"."provinces" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ADMINISTRATION"."municipalities" (
    "id" TEXT NOT NULL,
    "province_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipalities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provinces_code_key" ON "ADMINISTRATION"."provinces"("code");
CREATE INDEX "provinces_name_idx" ON "ADMINISTRATION"."provinces"("name");
CREATE UNIQUE INDEX "municipalities_province_id_code_key" ON "ADMINISTRATION"."municipalities"("province_id", "code");
CREATE INDEX "municipalities_province_id_idx" ON "ADMINISTRATION"."municipalities"("province_id");
CREATE INDEX "municipalities_name_idx" ON "ADMINISTRATION"."municipalities"("name");

ALTER TABLE "ADMINISTRATION"."municipalities" ADD CONSTRAINT "municipalities_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "ADMINISTRATION"."provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
