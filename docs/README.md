# Documentacion de RUTA RD Transport API

Esta carpeta contiene la documentacion operativa de la API NestJS del proyecto `transport-api`.

La API cubre identidad, perfiles de cliente, transporte, operaciones, tracking, facturacion, soporte y administracion.

## Archivos

| Archivo | Contenido |
| --- | --- |
| [api-usage.md](./api-usage.md) | Como consumir la API: base URL, autenticacion, headers, respuestas, errores, paginacion y rate limit. |
| [endpoints.md](./endpoints.md) | Referencia de endpoints agrupados por modulo, con metodo, ruta, acceso y DTO principal. |
| [flows.md](./flows.md) | Flujos recomendados de uso: registro, cliente, cotizacion, orden, dispatch, tracking, pagos y soporte. |
| [troubleshooting-500.md](./troubleshooting-500.md) | Donde encontrar el detalle real de errores `500` usando logs y `x-request-id`. |

## Base URL

En desarrollo, la API queda disponible por defecto en:

```text
http://localhost:3000/api/v1
```

El prefijo se define con `API_PREFIX`, cuyo valor por defecto es `api/v1`.

## Swagger

Swagger queda disponible en:

```text
http://localhost:3000/api/docs
```

Condiciones para verlo disponible:

| Variable | Requisito |
| --- | --- |
| `SWAGGER_ENABLED` | `true` |
| `NODE_ENV` | Cualquier valor distinto de `production` |

## Autenticacion

La mayoria de endpoints requieren JWT:

```http
Authorization: Bearer <accessToken>
```

Endpoints publicos principales:

| Metodo | Ruta |
| --- | --- |
| `GET` | `/api/v1/health` |
| `POST` | `/api/v1/auth/login` |
| `POST` | `/api/v1/auth/register` |
| `POST` | `/api/v1/auth/refresh` |
| `GET` | `/api/v1/vehicle-categories` |
| `GET` | `/api/v1/vehicle-categories/:id` |
| `POST` | `/api/v1/webhooks/internal` |

## Roles

Los controladores usan roles del dominio:

| Rol | Uso general |
| --- | --- |
| `ADMIN` | Administracion total, tarifas, auditoria, parametros y operaciones sensibles. |
| `OPERATOR` | Gestion operativa, ordenes, conductores, vehiculos, soporte y facturacion interna. |
| `CUSTOMER` | Perfil de cliente, cotizaciones, ordenes propias, pagos y seguimiento. |
| `DRIVER` | Asignaciones, tracking, eventos, evidencias y estado operativo. |

## Convencion de respuesta

Las respuestas exitosas usan un envelope global:

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
    "message": "Validation failed",
    "details": []
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-15T00:00:00.000Z",
    "path": "/api/v1/resource"
  }
}
```

## Fuentes de verdad en codigo

| Tema | Fuente |
| --- | --- |
| Bootstrap, prefijo global, CORS, Swagger | `src/main.ts` |
| Guards, filtros, interceptor global | `src/app.module.ts` |
| Formato de respuesta | `src/common/interceptors/response.interceptor.ts` |
| Formato de errores | `src/common/filters/*.ts` |
| Rutas y roles | `src/**/*.controller.ts` |
| Payloads y query params | `src/**/dto/*.ts` |

## Diagnostico de errores 500

Si Swagger muestra `500 Undocumented` o la API responde `INTERNAL_ERROR`, consulta [troubleshooting-500.md](./troubleshooting-500.md).

El detalle real no se devuelve en el body por seguridad. Debe buscarse en los logs del proceso donde corre NestJS usando `meta.requestId` o el header `x-request-id`.
