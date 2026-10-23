-- Remove duplicated webhook deliveries before enforcing uniqueness: keep the
-- oldest row of each external_event_id (ties broken by id).
DELETE FROM "INTEGRATIONS"."webhook_events" we
USING "INTEGRATIONS"."webhook_events" keep
WHERE we."external_event_id" = keep."external_event_id"
  AND (we."created_at", we."id") > (keep."created_at", keep."id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_external_event_id_key" ON "INTEGRATIONS"."webhook_events"("external_event_id");

