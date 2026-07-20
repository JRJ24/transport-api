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
- `POST /api/v1/routes/compute` (Google Routes API, server-side)
- `GET /api/v1/routes/orders/:orderId` (ruta cacheada de la orden: polyline + ETA)
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
- `POST /api/v1/orders/:id/accept` (alias para el conductor: acepta su asignacion)
- `PATCH /api/v1/orders/:id/status` (con maquina de estados por rol)
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
- `POST /api/v1/tracking/sessions` (crear o recuperar sesion activa)
- `GET /api/v1/tracking/sessions/active`
- `POST /api/v1/tracking/sessions/:sessionId/locations` (punto individual)
- `POST /api/v1/tracking/sessions/:sessionId/locations/batch` (sync offline)
- `POST /api/v1/tracking/sessions/:sessionId/stop`
- `POST /api/v1/order-events`
- `GET /api/v1/order-events/orders/:orderId`
- `GET /api/v1/eta/orders/:orderId`

Soporte:

- `GET /api/v1/attachments`
- `POST /api/v1/attachments`
- `GET /api/v1/notifications/me`
- `POST /api/v1/notifications`
- `POST /api/v1/notifications/test` (enviar push de prueba)
- `PATCH /api/v1/notifications/:id/read` (con verificacion de propiedad)
- `POST /api/v1/devices` (registrar token FCM del dispositivo)
- `GET /api/v1/devices/me`
- `DELETE /api/v1/devices/:token`
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

## Integracion TMS, mapa en vivo y pagos

- El TMS (`transport-portal`) usa `Authorization: Bearer <accessToken>` contra `/api/v1`.
- `POST /api/v1/orders/tms` permite que `ADMIN` y `OPERATOR` creen ordenes desde la torre de control.
- Socket.IO queda publicado en `/socket.io`; los clientes deben enviar el access token en `auth.token`.
- Eventos principales: `tracking:join-order`, `tracking:leave-order`, `tracking:driver-location`, `tracking:location`, `tracking:trip-started`, `tracking:trip-ended`.
- CardNet es el provider por defecto con `PAYMENT_PROVIDER=cardnet`; Azul queda disponible con `PAYMENT_PROVIDER=azul` o por request usando `provider`.
- Los webhooks de pagos quedan en `/api/v1/webhooks/cardnet` y `/api/v1/webhooks/azul`.

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

## App del conductor (transport-driver)

La app movil `transport-driver` consume esta API para login, ordenes asignadas,
ruta con Google Maps, tracking GPS en vivo y notificaciones push.

### Variables de entorno nuevas

```env
# Google Routes API (server-side ONLY — nunca en el movil)
GOOGLE_MAPS_SERVER_API_KEY=
GOOGLE_ROUTES_API_BASE_URL=https://routes.googleapis.com
GOOGLE_ROUTES_TIMEOUT_MS=10000

# Ajuste de ingesta GPS
GPS_MAX_ACCURACY_M=100
GPS_MAX_SPEED_MPS=70
TRACKING_MAX_BATCH=500

# Firebase Cloud Messaging (FCM HTTP v1, server-side ONLY)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=            # newlines escapados como \n
# GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json  (alternativa)

# Redis / BullMQ (cola de push). Sin REDIS_URL => entrega inline (sin Redis).
# REDIS_URL=redis://127.0.0.1:6379
NOTIFICATIONS_QUEUE_DRIVER=inline   # o "bullmq"
```

### Google Cloud

Habilita **Routes API** (y **Geocoding API** si se usa) en el proyecto. La clave
`GOOGLE_MAPS_SERVER_API_KEY` se restringe por **IP del servidor** y a esas APIs.
Los SDK de mapas (Android/iOS) usan claves distintas restringidas por app,
configuradas en la app movil — no aqui.

### Firebase

Crea un service account con permiso de FCM y coloca sus credenciales en las
variables `FIREBASE_*` (o apunta `GOOGLE_APPLICATION_CREDENTIALS` a un JSON).
**Nunca** subas el service account al repositorio. Si no hay credenciales, el
push queda deshabilitado y las notificaciones solo se persisten + emiten por
WebSocket (degradacion controlada).

### Cola de push (BullMQ + Redis)

Con `NOTIFICATIONS_QUEUE_DRIVER=bullmq` (o `REDIS_URL` definido) la entrega usa
BullMQ con reintentos exponenciales. Levanta Redis, por ejemplo:

```bash
docker run -p 6379:6379 redis:7-alpine
```

Sin Redis, el dispatcher entrega inline con reintento best-effort.

### Migraciones

La feature agrega la migracion `20260720200000_driver_tracking_devices`
(no destructiva): modelo `DeviceToken`, campos de tracking en `DriverLocation`
(`sessionId`, `sequence`, `clientId` idempotente, `heading`, `altitude`,
`isMocked`, `vehicleId`), estado/indices en `Notification`, indices de tracking
y precision `Decimal(9,6)` en coordenadas.

```bash
pnpm run db:deploy     # aplica migraciones (produccion/CI)
pnpm run db:migrate    # crea/aplica en desarrollo
```

### Eventos WebSocket (ampliados)

- Salas autorizadas: `user:{userId}`, `driver:{driverId}`, `order:{orderId}`,
  `vehicle:{vehicleId}`, `tracking:operations`. El join a `order:` se autoriza
  por rol/propiedad; el handshake valida el JWT.
- Eventos: `tracking:location.updated`, `tracking:started`, `tracking:stopped`,
  `tracking:location.batch-processed`, `order.status.changed`,
  `notification.created` (+ legacy `tracking:location`).

### Seguridad del tracking

`driverId`/`vehicleId`/`orderId` se derivan de la sesion autenticada, no del
cliente. Se valida rol de conductor, perfil activo, asignacion a la orden y
rango de coordenadas; los puntos anomalos (baja precision, saltos imposibles) se
**registran** para revision sin descartarse silenciosamente. La idempotencia por
`(sessionId, clientId)` evita duplicados en reintentos/batch.

### Probar tracking con ubicacion simulada

Simula ubicaciones en el emulador (Android: *Extended controls → Location*; iOS:
*Features → Location*). Verifica con `GET /tracking/sessions/active` y
`GET /locations/orders/:orderId`. El Portal TMS observa el vehiculo por el room
`order:{orderId}` / `tracking:operations`.

### Enviar una notificacion de prueba

Con un token ADMIN/OPERATOR: `POST /api/v1/notifications/test` con
`{ "userId": "<conductor>" }`, o el propio conductor sin body. Requiere Firebase
configurado y un development build en el dispositivo.

## Verificacion

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run test
pnpm run build
```
