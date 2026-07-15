# RUTA RD Transport API

API NestJS para el monolito modular de transporte: identidad, perfiles de cliente, operaciones, tracking, facturacion, soporte y administracion.

## Stack

- NestJS 11
- Prisma 7 + PostgreSQL
- JWT access/refresh tokens con sesiones revocables
- Swagger en desarrollo
- Pino logger con `x-request-id`
- Validacion global con `class-validator`

## Setup

```bash
pnpm install
cp .env.example .env
pnpm run db:generate
pnpm run db:migrate
pnpm run db:seed
```

## Desarrollo

```bash
pnpm run start:dev
```

Por defecto la API queda en `http://localhost:3000/api/v1`.

Swagger queda disponible en `http://localhost:3000/api/docs` cuando `SWAGGER_ENABLED=true` y `NODE_ENV` no es `production`.

## Scripts

```bash
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm run lint
pnpm run db:migrate
pnpm run db:deploy
pnpm run db:generate
pnpm run db:seed
```

## Endpoints Implementados

Publicos:

- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/refresh`

Autenticacion y sesiones:

- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/auth/me`
- `GET /api/v1/sessions/me`
- `DELETE /api/v1/sessions/:id`
- `DELETE /api/v1/sessions/users/:userId`

Usuarios y roles:

- `GET /api/v1/users`
- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me`
- `GET /api/v1/users/:id`
- `GET /api/v1/roles`
- `POST /api/v1/roles/assign`
- `POST /api/v1/roles/revoke`

Clientes:

- `GET /api/v1/customers/me`
- `POST /api/v1/customers/me`
- `PATCH /api/v1/customers/me`
- `GET /api/v1/customers/me/addresses`
- `POST /api/v1/customers/me/addresses`
- `PATCH /api/v1/customers/me/addresses/:id`
- `DELETE /api/v1/customers/me/addresses/:id`

Transporte:

- `GET /api/v1/vehicle-categories`
- `POST /api/v1/vehicle-categories`
- `PATCH /api/v1/vehicle-categories/:id`
- `DELETE /api/v1/vehicle-categories/:id`
- `POST /api/v1/routes/estimate`
- `GET /api/v1/pricing/rate-cards`
- `POST /api/v1/pricing/rate-cards`
- `PATCH /api/v1/pricing/rate-cards/:id`
- `GET /api/v1/pricing/rate-cards/:id/rules`
- `POST /api/v1/pricing/rate-cards/:id/rules`
- `POST /api/v1/pricing/quotes`
- `GET /api/v1/pricing/quotes/:id`
- `POST /api/v1/orders`
- `GET /api/v1/orders`
- `GET /api/v1/orders/:id`
- `PATCH /api/v1/orders/:id/status`
- `POST /api/v1/orders/:id/cancel`
- `GET /api/v1/orders/:id/events`
- `GET /api/v1/reservations`
- `POST /api/v1/reservations`
- `PATCH /api/v1/reservations/:id/reschedule`
- `PATCH /api/v1/reservations/:id/cancel`
- `PATCH /api/v1/reservations/:id/complete`

Operaciones:

- `GET /api/v1/drivers`
- `GET /api/v1/drivers/me`
- `POST /api/v1/drivers`
- `GET /api/v1/drivers/:id`
- `PATCH /api/v1/drivers/:id/status`
- `PATCH /api/v1/drivers/:id/verification`
- `GET /api/v1/vehicles`
- `POST /api/v1/vehicles`
- `GET /api/v1/vehicles/:id`
- `PATCH /api/v1/vehicles/:id`
- `GET /api/v1/vehicles/:id/documents`
- `POST /api/v1/vehicles/:id/documents`
- `GET /api/v1/assignments`
- `POST /api/v1/assignments`
- `PATCH /api/v1/assignments/:id/accept`
- `PATCH /api/v1/assignments/:id/reject`
- `PATCH /api/v1/assignments/:id/complete`
- `GET /api/v1/dispatch/pending-orders`
- `GET /api/v1/dispatch/available-drivers`
- `POST /api/v1/dispatch`

Tracking:

- `POST /api/v1/locations`
- `GET /api/v1/locations/orders/:orderId`
- `GET /api/v1/locations/orders/:orderId/latest`
- `POST /api/v1/trips/start`
- `PATCH /api/v1/trips/:id/end`
- `GET /api/v1/trips/orders/:orderId`
- `POST /api/v1/order-events`
- `GET /api/v1/order-events/orders/:orderId`
- `GET /api/v1/eta/orders/:orderId`

Soporte:

- `GET /api/v1/attachments`
- `POST /api/v1/attachments`
- `GET /api/v1/notifications/me`
- `POST /api/v1/notifications`
- `PATCH /api/v1/notifications/:id/read`
- `GET /api/v1/incidents`
- `POST /api/v1/incidents`
- `PATCH /api/v1/incidents/:id/status`
- `POST /api/v1/incidents/:id/comments`
- `GET /api/v1/delivery-proofs`
- `POST /api/v1/delivery-proofs`
- `PATCH /api/v1/delivery-proofs/:id/validate`
- `POST /api/v1/delivery-proofs/:id/signatures`

Facturacion interna/mock:

- `GET /api/v1/payments`
- `POST /api/v1/payments`
- `GET /api/v1/payments/:id`
- `PATCH /api/v1/payments/:id/status`
- `GET /api/v1/transactions`
- `POST /api/v1/transactions`
- `GET /api/v1/refunds`
- `POST /api/v1/refunds`
- `PATCH /api/v1/refunds/:id/status`
- `GET /api/v1/cancellation-fees/orders/:orderId`
- `GET /api/v1/webhooks`
- `POST /api/v1/webhooks/internal`

Administracion:

- `GET /api/v1/catalogs`
- `POST /api/v1/catalogs`
- `PATCH /api/v1/catalogs/:id`
- `GET /api/v1/parameters`
- `PUT /api/v1/parameters`
- `GET /api/v1/audit`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/reports/operations`
- `GET /api/v1/reports/billing`

## Flujo de Cliente

1. `POST /auth/register` crea el usuario y asigna el rol `CUSTOMER`.
2. `POST /customers/me` crea el perfil de cliente con documento y datos fiscales.
3. `POST /customers/me/addresses` registra direcciones de recogida/entrega.
4. `POST /routes/estimate` estima distancia/duracion con proveedor interno.
5. `POST /pricing/quotes` crea una cotizacion interna/mock.
6. `POST /orders` crea la orden desde una cotizacion valida.
7. Operaciones usa `POST /dispatch` o `POST /assignments` para asignar conductor/vehiculo.
8. Tracking, evidencias, incidentes y pagos avanzan el ciclo operativo sin proveedores externos.

El perfil de cliente es separado del registro para permitir onboarding progresivo.

## Respuestas

Las respuestas exitosas usan el envelope global:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z"
  }
}
```

Los errores usan:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z",
    "path": "/api/v1/resource"
  }
}
```

## Verificacion

```bash
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm exec eslint "{src,test}/**/*.ts"
pnpm run test:e2e
```
