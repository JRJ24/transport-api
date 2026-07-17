# Como encontrar errores 500

Esta guia explica donde buscar el detalle real cuando la API responde con:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error"
  },
  "meta": {
    "requestId": "7667ff0f-ecbf-4088-b82e-33c43ae7baf4",
    "timestamp": "2026-07-16T19:57:36.024Z",
    "path": "/api/v1/auth/register"
  }
}
```

## Resumen rapido

| Dato | Donde buscar |
| --- | --- |
| `requestId` | Header `x-request-id` o `meta.requestId` del response. |
| Stack trace del error | Consola, stdout o logs del proceso donde corre NestJS. |
| Codigo que convierte errores a response | `src/common/filters/all-exceptions.filter.ts`. |
| Configuracion del logger | `src/app.module.ts`, `LoggerModule.forRootAsync`. |
| Errores Prisma conocidos | `src/common/filters/prisma-exception.filter.ts`. |
| Endpoint que fallo | Controller y service del modulo correspondiente, por ejemplo `src/modules/identity/auth/**`. |

## Por que Swagger dice `Undocumented`

En Swagger, `Undocumented` no significa que el error no exista. Significa que el endpoint no tiene un `@ApiResponse` especifico para ese status code.

El backend si esta devolviendo un error controlado por el filtro global. Para saber la causa real, hay que revisar los logs del servidor con el `requestId`.

## Paso 1: copiar el request id

En el response del error, copia este valor:

```text
7667ff0f-ecbf-4088-b82e-33c43ae7baf4
```

Tambien viene en el header:

```http
x-request-id: 7667ff0f-ecbf-4088-b82e-33c43ae7baf4
```

Ese id se genera o se respeta desde el header `x-request-id`. El codigo esta en `src/app.module.ts`, dentro de `genReqId`.

## Paso 2: buscar el error en los logs

### Desarrollo local con `pnpm run start:dev`

Si levantaste la API con:

```bash
pnpm run start:dev
```

El detalle del error aparece en la misma terminal donde esta corriendo NestJS.

Busca una linea cercana al timestamp del response:

```text
2026-07-16T19:57:36.024Z
```

Tambien busca por la ruta:

```text
POST /api/v1/auth/register
```

O por el request id:

```text
7667ff0f-ecbf-4088-b82e-33c43ae7baf4
```

En desarrollo, el proyecto usa `pino-pretty`, por lo que el log se ve en formato legible.

### Desarrollo local guardando logs en archivo

El repo no configura archivos de log por defecto. Si necesitas guardar la salida para revisar despues, puedes levantar la API redirigiendo stdout/stderr:

```powershell
pnpm run start:dev *> api.log
```

Luego busca el request id:

```powershell
Select-String -Path "api.log" -Pattern "7667ff0f-ecbf-4088-b82e-33c43ae7baf4"
```

### Docker

Si la API corre en Docker, revisa stdout del contenedor:

```bash
docker logs <container-name-or-id>
```

Para buscar el request id:

```bash
docker logs <container-name-or-id> 2>&1 | grep "7667ff0f-ecbf-4088-b82e-33c43ae7baf4"
```

En Windows PowerShell:

```powershell
docker logs <container-name-or-id> 2>&1 | Select-String "7667ff0f-ecbf-4088-b82e-33c43ae7baf4"
```

### PM2

Si corre con PM2:

```bash
pm2 logs transport-api --lines 200
```

Para inspeccionar archivos de PM2:

```bash
pm2 info transport-api
```

PM2 muestra la ruta de `out log path` y `error log path`.

### systemd o servidor Linux

Si corre como servicio:

```bash
journalctl -u transport-api -n 200 --no-pager
```

Con filtro por request id:

```bash
journalctl -u transport-api --no-pager | grep "7667ff0f-ecbf-4088-b82e-33c43ae7baf4"
```

## Paso 3: identificar que filtro produjo el response

Los errores `500` con `INTERNAL_ERROR` salen principalmente de:

```text
src/common/filters/all-exceptions.filter.ts
```

El bloque importante es cuando la excepcion no es `HttpException` ni `DomainException`:

```ts
this.logger.error(
  `Unhandled exception on ${request.method} ${request.url}: ${error.message}`,
  error.stack,
);
```

Eso significa:

| Caso | Resultado |
| --- | --- |
| Excepcion no controlada | HTTP `500`, `INTERNAL_ERROR`, stack trace en logs. |
| `HttpException` conocida | HTTP segun excepcion, mensaje controlado. |
| `DomainException` | HTTP `422`, `DOMAIN_RULE_VIOLATION` u otro codigo de dominio. |

Para errores Prisma conocidos, revisar:

```text
src/common/filters/prisma-exception.filter.ts
```

Ese filtro convierte estos errores:

| Prisma code | HTTP | API code |
| --- | --- | --- |
| `P2002` | `409` | `RESOURCE_CONFLICT` |
| `P2025` | `404` | `RESOURCE_NOT_FOUND` |
| `P2003` | `409` | `RESOURCE_CONFLICT` |

Si Prisma devuelve otro codigo no manejado, puede terminar como `500` y debe buscarse en logs como `Unhandled Prisma error`.

## Paso 4: ubicar el modulo del endpoint

Para el ejemplo:

```text
POST /api/v1/auth/register
```

Revisa estos archivos:

| Archivo | Que revisar |
| --- | --- |
| `src/modules/identity/auth/presentation/auth.controller.ts` | Define `POST /auth/register`. |
| `src/modules/identity/auth/presentation/dto/register.dto.ts` | Valida el body de registro. |
| `src/modules/identity/auth/application/auth.service.ts` | Orquesta el caso de uso de auth. |
| `src/modules/identity/auth/application/use-cases/register.use-case.ts` | Logica principal del registro. |
| `src/modules/identity/users/**` | Creacion/presentacion de usuario. |
| `prisma/schema.prisma` | Restricciones de base de datos y enums. |

## Checklist para un `500` en `/auth/register`

| Verificacion | Donde verlo |
| --- | --- |
| Variables `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` validas | `.env` y `src/config/env.validation.ts`. |
| `DATABASE_URL` configurado | `.env` y logs de arranque. |
| Prisma Client generado | Ejecutar `pnpm run db:generate` si faltan tipos/client. |
| Migraciones aplicadas | Ejecutar `pnpm run db:migrate` en desarrollo o `pnpm run db:deploy` en ambiente desplegado. |
| Roles seed creados | Ejecutar `pnpm run db:seed` si falta el rol `CUSTOMER`. |
| Email o telefono duplicado | Deberia responder `409 RESOURCE_CONFLICT`; si responde `500`, revisar logs Prisma. |
| Payload cumple el DTO | Revisar `RegisterDto`; errores de DTO deberian ser `400 VALIDATION_FAILED`. |

## Como reproducir con request id fijo

Puedes enviar un `x-request-id` propio para encontrarlo mas facil en logs:

```bash
curl -X POST "http://localhost:3000/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "x-request-id: debug-register-001" \
  -d '{
    "fullName": "Juan Perez",
    "email": "juan.perez@example.com",
    "phone": "+18095551234",
    "password": "Password123",
    "platform": "web",
    "deviceName": "Chrome"
  }'
```

Luego busca:

```text
debug-register-001
```

## Que informacion reportar

Cuando reportes un `500`, incluye:

| Dato | Ejemplo |
| --- | --- |
| Metodo y ruta | `POST /api/v1/auth/register` |
| `requestId` | `7667ff0f-ecbf-4088-b82e-33c43ae7baf4` |
| Timestamp | `2026-07-16T19:57:36.024Z` |
| Body enviado | Sin passwords reales ni tokens reales. |
| Ambiente | Local, Docker, staging, production. |
| Stack trace del log | La parte del log donde aparece la excepcion. |

No pegues tokens reales, passwords reales, cookies ni secretos de `.env`.

## Importante

El body HTTP del `500` oculta el detalle del error por seguridad. La causa real se obtiene en los logs del proceso, no desde Swagger.
