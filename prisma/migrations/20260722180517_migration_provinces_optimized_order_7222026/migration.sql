-- DropForeignKey
ALTER TABLE "ORDERS"."TransportOrders" DROP CONSTRAINT "TransportOrders_quotes_id_fkey";

-- AddForeignKey
ALTER TABLE "ORDERS"."TransportOrders" ADD CONSTRAINT "TransportOrders_quotes_id_fkey" FOREIGN KEY ("quotes_id") REFERENCES "PRICES"."price_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
