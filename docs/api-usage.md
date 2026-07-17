# Uso de la API

Esta guia explica como consumir la API desde clientes web, moviles, backoffice o integraciones internas.

## Base URL

| Entorno | URL |
| --- | --- |
| Local por defecto | `http://localhost:3000/api/v1` |
| Swagger local | `http://localhost:3000/api/docs` |

El puerto por defecto es `3000`. El prefijo por defecto es `api/v1`.

## Variables relevantes

| Variable | Default | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP de la API. |
| `API_PREFIX` | `api/v1` | Prefijo global de rutas. |
| `CORS_ORIGINS` | `http://localhost:5173` | Origenes permitidos separados por coma. |
| `SWAGGER_ENABLED` | `true` | Habilita Swagger fuera de produccion. |
| `THROTTLE_TTL_MS` | `60000` | Ventana del rate limit global. |
| `THROTTLE_LIMIT` | `100` | Limite global por ventana. |
| `JWT_ACCESS_TTL` | `15m` | Duracion del access token. |
| `JWT_REFRESH_TTL_WEB` | `7d` | Duracion del refresh token web. |
| `JWT_REFRESH_TTL_MOBILE` | `30d` | Duracion del refresh token movil. |

## Headers

| Header | Requerido | Descripcion |
| --- | --- | --- |
| `Content-Type: application/json` | Si hay body | Los DTOs esperan JSON. |
| `Authorization: Bearer <accessToken>` | En rutas privadas | JWT de acceso emitido por login/register/refresh. |
| `x-request-id: <uuid>` | Opcional | Correlation id. Si no se envia, la API genera uno y lo devuelve. |

## Autenticacion

El flujo usa access token y refresh token.

1. Inicia sesion con `POST /auth/login` o registra una cuenta con `POST /auth/register`.
2. Usa `data.accessToken` como Bearer token en rutas privadas.
3. Cuando el access token expire, usa `POST /auth/refresh` con `data.refreshToken`.
4. Usa `POST /auth/logout` para revocar la sesion actual.
5. Usa `POST /auth/logout-all` para revocar todas las sesiones del usuario.

### Login

```bash
curl -X POST "http://localhost:3000/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@correo.com",
    "password": "Password123",
    "platform": "web",
    "deviceName": "Chrome"
  }'
```

Respuesta esperada:

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "sessionId": "7b0ec8c2-6b46-4f44-9cb0-47de0e4a0d9f",
    "user": {
      "id": "1b3d5b51-29ea-4fe0-97ea-83458e3c5a54",
      "fullName": "Juan Perez",
      "email": "usuario@correo.com",
      "phone": "+18095551234",
      "status": "ACTIVE",
      "roles": ["CUSTOMER"],
      "lastLoginAt": "2026-07-15T00:00:00.000Z",
      "createdAt": "2026-07-15T00:00:00.000Z"
    }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z"
  }
}
```

### Refresh

```bash
curl -X POST "http://localhost:3000/api/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "jwt-refresh-token"
  }'
```

Respuesta esperada:

```json
{
  "success": true,
  "data": {
    "accessToken": "new-jwt-access-token",
    "refreshToken": "new-jwt-refresh-token",
    "tokenType": "Bearer",
    "expiresIn": 900
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z"
  }
}
```

## Rutas publicas

| Metodo | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/health` | Liveness/readiness. |
| `POST` | `/auth/login` | Inicio de sesion. |
| `POST` | `/auth/register` | Registro de cliente. |
| `POST` | `/auth/refresh` | Rotacion de refresh token. |
| `GET` | `/vehicle-categories` | Consulta de categorias activas. |
| `GET` | `/vehicle-categories/:id` | Consulta de una categoria. |
| `POST` | `/webhooks/internal` | Webhook interno/mock. |

Todas las rutas anteriores son relativas a `/api/v1`.

## Respuestas exitosas

Todas las respuestas exitosas pasan por un interceptor global.

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

Para endpoints con codigo `204 No Content`, como algunos logout/delete/revoke, no se debe depender de un body de respuesta.

## Errores

Los errores usan un envelope comun.

Para diagnosticar errores `500 INTERNAL_ERROR`, consulta [troubleshooting-500.md](./troubleshooting-500.md). El detalle real se busca en los logs del servidor usando `meta.requestId` o el header `x-request-id`.

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested record was not found"
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z",
    "path": "/api/v1/orders/uuid"
  }
}
```

Codigos frecuentes:

| Codigo | HTTP comun | Significado |
| --- | --- | --- |
| `AUTH_UNAUTHORIZED` | `401` | Falta token, token invalido o sesion no valida. |
| `AUTH_INVALID_CREDENTIALS` | `401` | Credenciales incorrectas. |
| `AUTH_INVALID_REFRESH_TOKEN` | `401` | Refresh token invalido. |
| `AUTH_SESSION_EXPIRED` | `401` | Sesion expirada. |
| `AUTH_SESSION_REVOKED` | `401` | Sesion revocada. |
| `AUTH_ACCOUNT_INACTIVE` | `403` | Cuenta inactiva. |
| `AUTH_ACCOUNT_BLOCKED` | `403` | Cuenta bloqueada. |
| `FORBIDDEN` | `403` | Acceso denegado. |
| `FORBIDDEN_ROLE` | `403` | El rol no permite la operacion. |
| `FORBIDDEN_PERMISSION` | `403` | Falta permiso fino. |
| `VALIDATION_FAILED` | `400` | Body, path param o query invalido. |
| `BAD_REQUEST` | `400` | Solicitud invalida. |
| `RESOURCE_NOT_FOUND` | `404` | Recurso inexistente. |
| `RESOURCE_CONFLICT` | `409` | Conflicto de unicidad o relacion. |
| `RATE_LIMITED` | `429` | Limite de solicitudes excedido. |
| `DOMAIN_RULE_VIOLATION` | `422` | Regla de negocio incumplida. |
| `INTERNAL_ERROR` | `500` | Error no controlado. |

## Validacion

La API usa `ValidationPipe` global con:

| Opcion | Efecto |
| --- | --- |
| `transform: true` | Convierte tipos cuando los DTOs lo indican. |
| `whitelist: true` | Remueve campos que no estan en el DTO. |
| `forbidNonWhitelisted: true` | Rechaza campos no permitidos. |
| `stopAtFirstError: false` | Devuelve multiples errores de validacion. |

Ejemplo de error por validacion:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      "email must be an email"
    ]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

## Paginacion

Los endpoints paginados usan:

| Query param | Default | Minimo | Maximo |
| --- | --- | --- | --- |
| `page` | `1` | `1` | No aplica |
| `pageSize` | `20` | `1` | `100` |

Formato comun cuando el servicio devuelve paginacion:

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z"
  }
}
```

## Rate limit

El rate limit global usa `THROTTLE_TTL_MS` y `THROTTLE_LIMIT`.

Overrides de autenticacion:

| Endpoint | Limite |
| --- | --- |
| `POST /auth/login` | 5 solicitudes por minuto. |
| `POST /auth/register` | 3 solicitudes por minuto. |
| `POST /auth/refresh` | 10 solicitudes por minuto. |

## Recomendaciones para clientes

| Tema | Recomendacion |
| --- | --- |
| Tokens | Guardar `accessToken` y `refreshToken` de forma segura segun plataforma. |
| Refresh | Refrescar antes de reintentar solicitudes fallidas por expiracion. |
| Idempotencia | Evitar reintentos automaticos de `POST` que creen recursos sin verificar estado. |
| Request id | Enviar `x-request-id` desde frontends/backends para trazabilidad. |
| Fechas | Enviar fechas en ISO 8601, por ejemplo `2026-07-15T16:00:00.000Z`. |
| UUID | Los `:id` se validan como UUID en la mayoria de endpoints. |
