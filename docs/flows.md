# Flujos de uso

Los flujos siguientes usan rutas relativas a:

```text
http://localhost:3000/api/v1
```

En los ejemplos, reemplaza `$TOKEN`, `$CUSTOMER_TOKEN`, `$ADMIN_TOKEN`, `$OPERATOR_TOKEN` o `$DRIVER_TOKEN` por el access token correspondiente.

## 1. Registro, login y sesion

### Registrar cliente

```bash
curl -X POST "http://localhost:3000/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Juan Perez",
    "email": "juan.perez@example.com",
    "phone": "+18095551234",
    "password": "Password123",
    "platform": "web",
    "deviceName": "Chrome"
  }'
```

La respuesta incluye `accessToken`, `refreshToken`, `sessionId` y `user`.

### Consultar usuario autenticado

```bash
curl "http://localhost:3000/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN"
```

### Refrescar tokens

```bash
curl -X POST "http://localhost:3000/api/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "jwt-refresh-token"
  }'
```

### Cerrar sesion actual

```bash
curl -X POST "http://localhost:3000/api/v1/auth/logout" \
  -H "Authorization: Bearer $TOKEN"
```

## 2. Onboarding de cliente

Despues del registro, el usuario con rol `CUSTOMER` completa su perfil y direcciones.

### Crear perfil de cliente

```bash
curl -X POST "http://localhost:3000/api/v1/customers/me" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerType": "INDIVIDUAL",
    "documentType": "ID",
    "documentNumber": "00112345678",
    "billingEmail": "billing@example.com"
  }'
```

### Crear direccion frecuente

```bash
curl -X POST "http://localhost:3000/api/v1/customers/me/addresses" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Casa",
    "addressLine": "Av. Winston Churchill 123",
    "city": "Santo Domingo",
    "province": "Distrito Nacional",
    "latitude": 18.4861,
    "longitude": -69.9312,
    "isDefault": true
  }'
```

### Consultar direcciones

```bash
curl "http://localhost:3000/api/v1/customers/me/addresses" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

## 3. Cotizacion y orden

Este flujo crea una estimacion, una cotizacion y una orden de transporte.

### Listar categorias de vehiculo

```bash
curl "http://localhost:3000/api/v1/vehicle-categories"
```

### Estimar ruta

```bash
curl -X POST "http://localhost:3000/api/v1/routes/estimate" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originAddress": "Av. Winston Churchill 123",
    "originLatitude": 18.4861,
    "originLongitude": -69.9312,
    "destinationAddress": "Aeropuerto Internacional Las Americas",
    "destinationLatitude": 18.4301,
    "destinationLongitude": -69.6689
  }'
```

### Crear cotizacion

```bash
curl -X POST "http://localhost:3000/api/v1/pricing/quotes" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleCategoryId": "00000000-0000-0000-0000-000000000001",
    "originAddress": "Av. Winston Churchill 123",
    "destinationAddress": "Aeropuerto Internacional Las Americas",
    "distanceKm": 22.5,
    "estimatedDurationMin": 45,
    "requireHelper": false,
    "nightService": false
  }'
```

### Crear orden desde cotizacion

```bash
curl -X POST "http://localhost:3000/api/v1/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "00000000-0000-0000-0000-000000000010",
    "serviceType": "INMEDIATE",
    "notes": "Llamar al llegar",
    "stops": [
      {
        "stopType": "PICKUP",
        "sequence": 1,
        "contactName": "Juan Perez",
        "contactPhone": "+18095551234",
        "addressLine": "Av. Winston Churchill 123",
        "city": "Santo Domingo",
        "province": "Distrito Nacional",
        "latitude": 18.4861,
        "longitude": -69.9312,
        "instructions": "Entrada principal"
      },
      {
        "stopType": "DROPOFF",
        "sequence": 2,
        "contactName": "Maria Perez",
        "contactPhone": "+18095550000",
        "addressLine": "Aeropuerto Internacional Las Americas",
        "city": "Boca Chica",
        "province": "Santo Domingo",
        "latitude": 18.4301,
        "longitude": -69.6689
      }
    ],
    "items": [
      {
        "description": "Caja mediana",
        "quantity": 2,
        "weightKg": 12.5,
        "volumeM3": 0.4,
        "declaredValue": 5000,
        "fragile": false,
        "requireHelper": false
      }
    ]
  }'
```

### Consultar ordenes

```bash
curl "http://localhost:3000/api/v1/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

## 4. Operacion y dispatch

Estos endpoints suelen ser usados por `ADMIN` u `OPERATOR`.

### Crear conductor

```bash
curl -X POST "http://localhost:3000/api/v1/drivers" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "00000000-0000-0000-0000-000000000020",
    "licenseNumber": "DRV-123456",
    "licenseExpiration": "2028-12-31T00:00:00.000Z"
  }'
```

### Crear vehiculo

```bash
curl -X POST "http://localhost:3000/api/v1/vehicles" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "driverId": "00000000-0000-0000-0000-000000000021",
    "categoryId": "00000000-0000-0000-0000-000000000001",
    "plateNumber": "A123456",
    "brand": "Toyota",
    "model": "Hiace",
    "year": 2024,
    "color": "Blanco"
  }'
```

### Consultar ordenes pendientes para despacho

```bash
curl "http://localhost:3000/api/v1/dispatch/pending-orders" \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

### Despachar orden

```bash
curl -X POST "http://localhost:3000/api/v1/dispatch" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "driverId": "00000000-0000-0000-0000-000000000021",
    "vehicleId": "00000000-0000-0000-0000-000000000022"
  }'
```

## 5. Tracking y eventos

El conductor o el operador pueden iniciar viaje, enviar ubicaciones y crear eventos.

### Iniciar viaje

```bash
curl -X POST "http://localhost:3000/api/v1/trips/start" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "driverId": "00000000-0000-0000-0000-000000000021"
  }'
```

### Enviar ubicacion

```bash
curl -X POST "http://localhost:3000/api/v1/locations" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "driverId": "00000000-0000-0000-0000-000000000021",
    "orderId": "00000000-0000-0000-0000-000000000030",
    "latitude": 18.4861,
    "longitude": -69.9312,
    "accuracy": 12,
    "speed": 35,
    "batteryLevel": 80,
    "recordedAt": "2026-07-15T16:00:00.000Z"
  }'
```

### Crear evento de orden

```bash
curl -X POST "http://localhost:3000/api/v1/order-events" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "eventType": "PICKED_UP",
    "description": "Paquete recogido",
    "metadata": { "source": "mobile" },
    "latitude": 18.4861,
    "longitude": -69.9312
  }'
```

### Consultar ultima ubicacion y ETA

```bash
curl "http://localhost:3000/api/v1/locations/orders/00000000-0000-0000-0000-000000000030/latest" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

```bash
curl "http://localhost:3000/api/v1/eta/orders/00000000-0000-0000-0000-000000000030" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

## 6. Pagos, transacciones y reembolsos

Los pagos actuales son internos/mock segun los controladores.

### Crear pago

```bash
curl -X POST "http://localhost:3000/api/v1/payments" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "paymentMethod": "CASH",
    "amount": 1500,
    "currency": "DOP"
  }'
```

### Actualizar estado de pago

```bash
curl -X PATCH "http://localhost:3000/api/v1/payments/00000000-0000-0000-0000-000000000040/status" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "PAID",
    "providerReference": "internal-paid-123"
  }'
```

### Registrar transaccion

```bash
curl -X POST "http://localhost:3000/api/v1/transactions" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "00000000-0000-0000-0000-000000000040",
    "transactionType": "CAPTURE",
    "amount": 1500,
    "status": "SUCCESS",
    "providerResponse": { "provider": "internal-mock" }
  }'
```

### Crear reembolso

```bash
curl -X POST "http://localhost:3000/api/v1/refunds" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "00000000-0000-0000-0000-000000000040",
    "amount": 500,
    "reason": "Cancelacion parcial"
  }'
```

## 7. Soporte y evidencias

### Crear incidente

```bash
curl -X POST "http://localhost:3000/api/v1/incidents" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "incidentType": "DELAY",
    "severity": "MEDIUM",
    "title": "Retraso en recogida",
    "description": "El conductor reporta trafico intenso",
    "latitude": 18.4861,
    "longitude": -69.9312
  }'
```

### Agregar comentario a incidente

```bash
curl -X POST "http://localhost:3000/api/v1/incidents/00000000-0000-0000-0000-000000000050/comments" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Se contacto al cliente."
  }'
```

### Crear prueba de entrega

```bash
curl -X POST "http://localhost:3000/api/v1/delivery-proofs" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "00000000-0000-0000-0000-000000000030",
    "proofType": "PHOTO",
    "recipientName": "Maria Perez",
    "recipientDocument": "00112345678",
    "notes": "Entregado en recepcion",
    "latitude": 18.4301,
    "longitude": -69.6689
  }'
```

### Agregar firma a prueba de entrega

```bash
curl -X POST "http://localhost:3000/api/v1/delivery-proofs/00000000-0000-0000-0000-000000000060/signatures" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signatureUrl": "https://storage.local/signature.png",
    "signerName": "Maria Perez"
  }'
```

## 8. Administracion basica

### Crear catalogo

```bash
curl -X POST "http://localhost:3000/api/v1/catalogs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupKey": "incident-types",
    "code": "DELAY",
    "label": "Retraso",
    "sortOrder": 1,
    "isActive": true
  }'
```

### Crear o actualizar parametro

```bash
curl -X PUT "http://localhost:3000/api/v1/parameters" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "tax.rate",
    "value": "0.18",
    "valueType": "NUMBER",
    "description": "ITBIS aplicado a cotizaciones"
  }'
```

### Consultar dashboard y reportes

```bash
curl "http://localhost:3000/api/v1/dashboard/summary" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

```bash
curl "http://localhost:3000/api/v1/reports/operations" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

```bash
curl "http://localhost:3000/api/v1/reports/billing" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
