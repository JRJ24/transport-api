-- Remove duplicated role assignments before enforcing uniqueness: keep the
-- oldest row of each (user_id, roles_id) pair (ties broken by id).
DELETE FROM "AUTH"."user_roles" ur
USING "AUTH"."user_roles" keep
WHERE ur."user_id" = keep."user_id"
  AND ur."roles_id" = keep."roles_id"
  AND (ur."created_at", ur."id") > (keep."created_at", keep."id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_roles_id_key" ON "AUTH"."user_roles"("user_id", "roles_id");

