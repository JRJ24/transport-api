-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ADMINISTRATION";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "AUDIT";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "AUTH";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "CUSTOMER";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "DRIVERS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "EVIDENCES";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "INCIDENTS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "INTEGRATIONS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "NOTIFICATIONS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ORDERS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "PAIDS";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "PRICES";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "TRACKING";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "VEHICLES";

-- CreateEnum
CREATE TYPE "AUTH"."ROLES" AS ENUM ('ADMIN', 'OPERATOR', 'DRIVER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "AUTH"."STATUS_ACCOUNT" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CUSTOMER"."TYPE_CUSTOMER" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "DRIVERS"."STATUS_DRIVER" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE', 'SUSPENDED', 'VACATION');

-- CreateEnum
CREATE TYPE "DRIVERS"."VERIFICATION_STATUS" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VEHICLES"."VERIFICATION_STATUS_DOCS" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VEHICLES"."STATUS_VEHICLE" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CUSTOMER"."DOCUMENT_TYPE" AS ENUM ('ID', 'RNC', 'PASSPORT');

-- CreateEnum
CREATE TYPE "VEHICLES"."DOCUMENT_TYPE_VEHICLE" AS ENUM ('REGISTRATION', 'INSURANCE', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ORDERS"."SERVICE_TYPE" AS ENUM ('INMEDIATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ORDERS"."STATUS_ORDERS" AS ENUM ('DRAFT', 'REQUESTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PAIDS"."PAYMENT_STATUS" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ORDERS"."STOP_TYPE" AS ENUM ('PICKUP', 'DROPOFF', 'INTERMEDIATE');

-- CreateEnum
CREATE TYPE "ORDERS"."ASSIGNMENT_STATUS" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "INCIDENTS"."EVENT_TYPE" AS ENUM ('CREATED', 'ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CANCELLED', 'INCIDENT_REPORTED');

-- CreateEnum
CREATE TYPE "ORDERS"."RESERVATIONS_STATUS" AS ENUM ('ACTIVE', 'RESCHUDULED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ORDERS"."ORDER_CANCELLATION" AS ENUM ('CUSTOMER_CANCELLED', 'DRIVER_CANCELLED', 'ADMIN_CANCELLED', 'SYSTEM_CANCELLED');

-- CreateEnum
CREATE TYPE "TRACKING"."TRACKING_SESSIONS" AS ENUM ('ACTIVE', 'ENDED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "EVIDENCES"."PROOF_TYPE" AS ENUM ('PHOTO', 'SIGNATURE', 'QR', 'CODE', 'MIXED');

-- CreateEnum
CREATE TYPE "EVIDENCES"."VALIDATION" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "INCIDENTS"."INCIDENT_TYPE" AS ENUM ('DELAY', 'DAMAGE', 'CUSTOMER_ABSENT', 'WRONG_ADDRESS', 'VEHICLE_PROBLEM', 'OTHER');

-- CreateEnum
CREATE TYPE "INCIDENTS"."INCIDENT_SEVERITY" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "INCIDENTS"."INCIDENT_STATUS" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PAIDS"."PAYMENT_METHOD" AS ENUM ('CARD', 'CASH', 'TRANSFER', 'WALLET');

-- CreateEnum
CREATE TYPE "PAIDS"."STATUS_PAYMENTS" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PAIDS"."PAYMENT_TRANSACTIONS_TYPE" AS ENUM ('AUTHORIZATION', 'CAPTURE', 'REFUND', 'VOID', 'CANCELLATION_FEE');

-- CreateEnum
CREATE TYPE "PAIDS"."PAYMENTS_TRANSACTIONS_STATUS" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PAIDS"."PAYMENTS_REFUND_STATUS" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "NOTIFICATIONS"."NOTIFICATION_TYPE" AS ENUM ('ORDER_UPDATE', 'PAYMENT', 'INCIDENT', 'PROMOTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ADMINISTRATION"."SYSTEM_VALUE" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateTable
CREATE TABLE "AUTH"."users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AUTH"."STATUS_ACCOUNT" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AUTH"."roles" (
    "id" TEXT NOT NULL,
    "code" "AUTH"."ROLES" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AUTH"."user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "roles_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CUSTOMER"."customer_profile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "customer_type" "CUSTOMER"."TYPE_CUSTOMER" NOT NULL,
    "document_type" "CUSTOMER"."DOCUMENT_TYPE" NOT NULL,
    "document_number" TEXT NOT NULL,
    "company_name" TEXT,
    "billing_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CUSTOMER"."customer_addresses" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addresses_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "latitude" DECIMAL(65,30) NOT NULL,
    "longitude" DECIMAL(65,30) NOT NULL,
    "is_default" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DRIVERS"."driver_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "license_expiration" TIMESTAMP(3) NOT NULL,
    "availability_status" "DRIVERS"."STATUS_DRIVER" NOT NULL,
    "verification_status" "DRIVERS"."VERIFICATION_STATUS" NOT NULL,
    "rating_avg" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DRIVERS"."driver_documents" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "status" "DRIVERS"."VERIFICATION_STATUS" NOT NULL,
    "review_notes" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VEHICLES"."vehicle_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "max_weight_kg" DECIMAL(65,30) NOT NULL,
    "max_volumen_m3" DECIMAL(65,30) NOT NULL,
    "base_capacity_note" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VEHICLES"."vehicles" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "status" "VEHICLES"."STATUS_VEHICLE" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VEHICLES"."vehicles_documents" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "documentType" "VEHICLES"."DOCUMENT_TYPE_VEHICLE" NOT NULL,
    "file_url" TEXT NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "status" "VEHICLES"."VERIFICATION_STATUS_DOCS" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PRICES"."rate_cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "valid_form" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PRICES"."rate_rule" (
    "id" TEXT NOT NULL,
    "rate_card_id" TEXT NOT NULL,
    "vehicule_category_id" TEXT NOT NULL,
    "base_fare" DECIMAL(65,30) NOT NULL,
    "price_per_km" DECIMAL(65,30) NOT NULL,
    "price_per_minute" DECIMAL(65,30) NOT NULL,
    "minimum_fare" DECIMAL(65,30) NOT NULL,
    "helper_fee" DECIMAL(65,30) NOT NULL,
    "night_fee" DECIMAL(65,30) NOT NULL,
    "waiting_price_per_minute" DECIMAL(65,30) NOT NULL,
    "cancellation_fee" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PRICES"."price_quotes" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vehicle_category_id" TEXT NOT NULL,
    "origin_address" TEXT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "distance_km" DECIMAL(65,30) NOT NULL,
    "estimated_duration_min" INTEGER NOT NULL,
    "base_amount" DECIMAL(65,30) NOT NULL,
    "extras_amount" DECIMAL(65,30) NOT NULL,
    "demand_amount" DECIMAL(65,30) NOT NULL,
    "weather_amount" DECIMAL(65,30) NOT NULL,
    "tax_amount" DECIMAL(65,30) NOT NULL,
    "total_amount" DECIMAL(65,30) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."TransportOrders" (
    "id" TEXT NOT NULL,
    "order_code" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "quotes_id" TEXT NOT NULL,
    "vehicle_category_id" TEXT NOT NULL,
    "serviceType" "ORDERS"."SERVICE_TYPE" NOT NULL,
    "status" "ORDERS"."STATUS_ORDERS" NOT NULL,
    "schedule_at" TIMESTAMP(3),
    "pickup_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "distance_km" DECIMAL(65,30) NOT NULL,
    "estimated_duration_min" INTEGER NOT NULL,
    "total_amout" DECIMAL(65,30) NOT NULL,
    "paymentStatus" "PAIDS"."PAYMENT_STATUS" NOT NULL,
    "notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportOrders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."order_stops" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "stopType" "ORDERS"."STOP_TYPE" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "latitude" DECIMAL(65,30) NOT NULL,
    "longitude" DECIMAL(65,30) NOT NULL,
    "instructions" TEXT,
    "arrived_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "order_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "weight_kg" DECIMAL(65,30) NOT NULL,
    "volume_m3" DECIMAL(65,30),
    "declared_value" DECIMAL(65,30),
    "fragile" BOOLEAN NOT NULL,
    "require_helper" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."order_assignments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "assignment_status" "ORDERS"."ASSIGNMENT_STATUS" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),

    CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_type" "INCIDENTS"."EVENT_TYPE" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."reservation" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "reserved_for" TIMESTAMP(3) NOT NULL,
    "reservation_status" "ORDERS"."RESERVATIONS_STATUS" NOT NULL,
    "reschedule_count" INTEGER NOT NULL,
    "cancellation_deadline" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ORDERS"."order_cancellations" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "cancelled_by" TEXT NOT NULL,
    "cancellation_reason" TEXT NOT NULL,
    "cancellation_type" "ORDERS"."ORDER_CANCELLATION" NOT NULL,
    "fee_applied" BOOLEAN NOT NULL,
    "fee_amount" DECIMAL(65,30) NOT NULL,
    "refund_amount" DECIMAL(65,30) NOT NULL,
    "cancelled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DRIVERS"."driver_locations" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "latitude" DECIMAL(65,30) NOT NULL,
    "longitude" DECIMAL(65,30) NOT NULL,
    "accuracy" DECIMAL(65,30),
    "speed" DECIMAL(65,30),
    "battery_level" INTEGER,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TRACKING"."tracking_sessions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "status" "TRACKING"."TRACKING_SESSIONS" NOT NULL,
    "last_location_at" TIMESTAMP(3),

    CONSTRAINT "tracking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EVIDENCES"."delivery_proofs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "proof_type" "EVIDENCES"."PROOF_TYPE" NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_document" TEXT NOT NULL,
    "notes" TEXT,
    "latitude" DECIMAL(65,30) NOT NULL,
    "longitude" DECIMAL(65,30) NOT NULL,
    "captured_by" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validate_at" TIMESTAMP(3) NOT NULL,
    "validation_status" "EVIDENCES"."VALIDATION" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EVIDENCES"."signatures" (
    "id" TEXT NOT NULL,
    "proof_id" TEXT NOT NULL,
    "signature_url" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EVIDENCES"."attachments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "INCIDENTS"."incidents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "reported_by" TEXT NOT NULL,
    "incident_type" "INCIDENTS"."INCIDENT_TYPE" NOT NULL,
    "severity" "INCIDENTS"."INCIDENT_SEVERITY" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "INCIDENTS"."INCIDENT_STATUS" NOT NULL,
    "latitude" DECIMAL(65,30) NOT NULL,
    "longitude" DECIMAL(65,30) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "INCIDENTS"."incidents_comments" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PAIDS"."payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_method" "PAIDS"."PAYMENT_METHOD" NOT NULL,
    "payment_provider" TEXT,
    "status" "PAIDS"."PAYMENT_STATUS" NOT NULL,
    "providerReference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PAIDS"."payments_transactions" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "transaction_type" "PAIDS"."PAYMENT_TRANSACTIONS_TYPE" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "PAIDS"."PAYMENTS_TRANSACTIONS_STATUS" NOT NULL,
    "provider_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PAIDS"."refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PAIDS"."PAYMENTS_REFUND_STATUS" NOT NULL,
    "provider_response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NOTIFICATIONS"."notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "notification_type" "NOTIFICATIONS"."NOTIFICATION_TYPE" NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ADMINISTRATION"."system_parameters" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" "ADMINISTRATION"."SYSTEM_VALUE" NOT NULL,
    "description" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ADMINISTRATION"."catalogs" (
    "id" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AUDIT"."audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "INTEGRATIONS"."webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "INTEGRATIONS"."external_api_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "AUTH"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "AUTH"."users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "AUTH"."users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "AUTH"."users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "AUTH"."roles"("code");

-- CreateIndex
CREATE INDEX "driver_profiles_license_number_idx" ON "DRIVERS"."driver_profiles"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_code_key" ON "VEHICLES"."vehicle_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "VEHICLES"."vehicles"("plate_number");

-- CreateIndex
CREATE UNIQUE INDEX "TransportOrders_order_code_key" ON "ORDERS"."TransportOrders"("order_code");

-- CreateIndex
CREATE INDEX "TransportOrders_order_code_idx" ON "ORDERS"."TransportOrders"("order_code");

-- CreateIndex
CREATE INDEX "TransportOrders_customer_id_idx" ON "ORDERS"."TransportOrders"("customer_id");

-- CreateIndex
CREATE INDEX "TransportOrders_quotes_id_idx" ON "ORDERS"."TransportOrders"("quotes_id");

-- CreateIndex
CREATE INDEX "TransportOrders_vehicle_category_id_idx" ON "ORDERS"."TransportOrders"("vehicle_category_id");

-- CreateIndex
CREATE INDEX "order_stops_order_id_idx" ON "ORDERS"."order_stops"("order_id");

-- CreateIndex
CREATE INDEX "order_stops_contact_name_idx" ON "ORDERS"."order_stops"("contact_name");

-- CreateIndex
CREATE INDEX "order_stops_contact_phone_idx" ON "ORDERS"."order_stops"("contact_phone");

-- CreateIndex
CREATE INDEX "order_stops_address_line_idx" ON "ORDERS"."order_stops"("address_line");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "ORDERS"."order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_assignments_assigned_by_idx" ON "ORDERS"."order_assignments"("assigned_by");

-- CreateIndex
CREATE INDEX "order_assignments_order_id_idx" ON "ORDERS"."order_assignments"("order_id");

-- CreateIndex
CREATE INDEX "order_assignments_driver_id_idx" ON "ORDERS"."order_assignments"("driver_id");

-- CreateIndex
CREATE INDEX "order_assignments_vehicle_id_idx" ON "ORDERS"."order_assignments"("vehicle_id");

-- CreateIndex
CREATE INDEX "delivery_proofs_recipient_name_idx" ON "EVIDENCES"."delivery_proofs"("recipient_name");

-- CreateIndex
CREATE INDEX "attachments_entity_id_idx" ON "EVIDENCES"."attachments"("entity_id");

-- CreateIndex
CREATE INDEX "incidents_order_id_idx" ON "INCIDENTS"."incidents"("order_id");

-- CreateIndex
CREATE INDEX "incidents_reported_by_idx" ON "INCIDENTS"."incidents"("reported_by");

-- CreateIndex
CREATE INDEX "incidents_title_idx" ON "INCIDENTS"."incidents"("title");

-- CreateIndex
CREATE INDEX "incidents_comments_user_id_idx" ON "INCIDENTS"."incidents_comments"("user_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "PAIDS"."refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "PAIDS"."refunds"("payment_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "NOTIFICATIONS"."notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_title_idx" ON "NOTIFICATIONS"."notifications"("title");

-- CreateIndex
CREATE UNIQUE INDEX "system_parameters_key_key" ON "ADMINISTRATION"."system_parameters"("key");

-- CreateIndex
CREATE INDEX "system_parameters_key_idx" ON "ADMINISTRATION"."system_parameters"("key");

-- CreateIndex
CREATE INDEX "catalogs_code_idx" ON "ADMINISTRATION"."catalogs"("code");

-- CreateIndex
CREATE INDEX "audit_logs_entity_id_idx" ON "AUDIT"."audit_logs"("entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_ip_address_idx" ON "AUDIT"."audit_logs"("ip_address");

-- CreateIndex
CREATE INDEX "external_api_logs_request_payload_idx" ON "INTEGRATIONS"."external_api_logs"("request_payload");

-- CreateIndex
CREATE INDEX "external_api_logs_response_payload_idx" ON "INTEGRATIONS"."external_api_logs"("response_payload");

-- AddForeignKey
ALTER TABLE "AUTH"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AUTH"."user_roles" ADD CONSTRAINT "user_roles_roles_id_fkey" FOREIGN KEY ("roles_id") REFERENCES "AUTH"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CUSTOMER"."customer_profile" ADD CONSTRAINT "customer_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CUSTOMER"."customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "CUSTOMER"."customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DRIVERS"."driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DRIVERS"."driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "DRIVERS"."driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VEHICLES"."vehicles" ADD CONSTRAINT "vehicles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "VEHICLES"."vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VEHICLES"."vehicles_documents" ADD CONSTRAINT "vehicles_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "VEHICLES"."vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PRICES"."rate_rule" ADD CONSTRAINT "rate_rule_rate_card_id_fkey" FOREIGN KEY ("rate_card_id") REFERENCES "PRICES"."rate_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PRICES"."price_quotes" ADD CONSTRAINT "price_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "CUSTOMER"."customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PRICES"."price_quotes" ADD CONSTRAINT "price_quotes_vehicle_category_id_fkey" FOREIGN KEY ("vehicle_category_id") REFERENCES "VEHICLES"."vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."TransportOrders" ADD CONSTRAINT "TransportOrders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "CUSTOMER"."customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."TransportOrders" ADD CONSTRAINT "TransportOrders_quotes_id_fkey" FOREIGN KEY ("quotes_id") REFERENCES "PRICES"."price_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."TransportOrders" ADD CONSTRAINT "TransportOrders_vehicle_category_id_fkey" FOREIGN KEY ("vehicle_category_id") REFERENCES "VEHICLES"."vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_stops" ADD CONSTRAINT "order_stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_assignments" ADD CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_assignments" ADD CONSTRAINT "order_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "DRIVERS"."driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_assignments" ADD CONSTRAINT "order_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "VEHICLES"."vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_assignments" ADD CONSTRAINT "order_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "AUTH"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."reservation" ADD CONSTRAINT "reservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERS"."order_cancellations" ADD CONSTRAINT "order_cancellations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DRIVERS"."driver_locations" ADD CONSTRAINT "driver_locations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DRIVERS"."driver_locations" ADD CONSTRAINT "driver_locations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "DRIVERS"."driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TRACKING"."tracking_sessions" ADD CONSTRAINT "tracking_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TRACKING"."tracking_sessions" ADD CONSTRAINT "tracking_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "DRIVERS"."driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EVIDENCES"."delivery_proofs" ADD CONSTRAINT "delivery_proofs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EVIDENCES"."delivery_proofs" ADD CONSTRAINT "delivery_proofs_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EVIDENCES"."signatures" ADD CONSTRAINT "signatures_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "EVIDENCES"."delivery_proofs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EVIDENCES"."attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INCIDENTS"."incidents" ADD CONSTRAINT "incidents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INCIDENTS"."incidents" ADD CONSTRAINT "incidents_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INCIDENTS"."incidents_comments" ADD CONSTRAINT "incidents_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INCIDENTS"."incidents_comments" ADD CONSTRAINT "incidents_comments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "INCIDENTS"."incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAIDS"."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAIDS"."payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "CUSTOMER"."customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAIDS"."payments_transactions" ADD CONSTRAINT "payments_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "PAIDS"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAIDS"."refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDERS"."TransportOrders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAIDS"."refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "PAIDS"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NOTIFICATIONS"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ADMINISTRATION"."system_parameters" ADD CONSTRAINT "system_parameters_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "AUTH"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AUDIT"."audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "AUTH"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
