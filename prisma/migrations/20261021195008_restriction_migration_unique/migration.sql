/*
  Warnings:

  - A unique constraint covering the columns `[quotes_id]` on the table `TransportOrders` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PRICES"."rate_rule_card_category_key";

-- CreateIndex
CREATE UNIQUE INDEX "TransportOrders_quotes_id_key" ON "ORDERS"."TransportOrders"("quotes_id");
