# Endpoints

Todas las rutas son relativas a la base URL:

```text
http://localhost:3000/api/v1
```

Leyenda de acceso:

| Valor | Significado |
| --- | --- |
| `Publico` | No requiere JWT. |
| `Auth` | Requiere JWT valido, sin rol especifico en el controlador. |
| `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Requiere JWT y alguno de los roles indicados. |

## Health

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/health` | Publico | Ninguno |

## Identity

### Auth

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Publico | Body `LoginDto` |
| `POST` | `/auth/register` | Publico | Body `RegisterDto` |
| `POST` | `/auth/refresh` | Publico | Body `RefreshTokenDto` |
| `POST` | `/auth/logout` | Auth | Bearer token |
| `POST` | `/auth/logout-all` | Auth | Bearer token |
| `GET` | `/auth/me` | Auth | Bearer token |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `LoginDto` | `email`, `password`, `platform?`, `deviceId?`, `deviceName?` |
| `RegisterDto` | `fullName`, `email`, `phone`, `password`, `platform?`, `deviceId?`, `deviceName?` |
| `RefreshTokenDto` | `refreshToken` |

### Users

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/users` | `ADMIN`, `OPERATOR` | Query `UserQueryDto` |
| `GET` | `/users/me` | Auth | Bearer token |
| `PATCH` | `/users/me` | Auth | Body `UpdateProfileDto` |
| `GET` | `/users/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `UserQueryDto` | `page?`, `pageSize?`, `search?`, `status?` |
| `UpdateProfileDto` | `fullName?`, `phone?` |

### Customers

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/customers/me` | `CUSTOMER` | Bearer token |
| `POST` | `/customers/me` | `CUSTOMER` | Body `CreateCustomerProfileDto` |
| `PATCH` | `/customers/me` | `CUSTOMER` | Body `UpdateCustomerProfileDto` |
| `GET` | `/customers/me/addresses` | `CUSTOMER` | Bearer token |
| `POST` | `/customers/me/addresses` | `CUSTOMER` | Body `CreateCustomerAddressDto` |
| `PATCH` | `/customers/me/addresses/:id` | `CUSTOMER` | Path `id` UUID, body `UpdateCustomerAddressDto` |
| `DELETE` | `/customers/me/addresses/:id` | `CUSTOMER` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateCustomerProfileDto` | `customerType`, `documentType`, `documentNumber`, `companyName?`, `billingEmail?` |
| `CreateCustomerAddressDto` | `label`, `addressLine`, `city`, `province`, `latitude`, `longitude`, `isDefault?` |
| `UpdateCustomerProfileDto` | Campos opcionales de `CreateCustomerProfileDto` |
| `UpdateCustomerAddressDto` | Campos opcionales de `CreateCustomerAddressDto` |

### Sessions

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/sessions/me` | Auth | Bearer token |
| `DELETE` | `/sessions/:id` | Auth | Path `id` UUID |
| `DELETE` | `/sessions/users/:userId` | `ADMIN` | Path `userId` UUID |

### Roles

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/roles` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/roles/assign` | `ADMIN` | Body `AssignRoleDto` |
| `POST` | `/roles/revoke` | `ADMIN` | Body `AssignRoleDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `AssignRoleDto` | `userId`, `role` |

## Transport

### Vehicle Categories

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/vehicle-categories` | Publico | Query `includeInactive?` |
| `GET` | `/vehicle-categories/:id` | Publico | Path `id` UUID |
| `POST` | `/vehicle-categories` | `ADMIN`, `OPERATOR` | Body `CreateVehicleCategoryDto` |
| `PATCH` | `/vehicle-categories/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateVehicleCategoryDto` |
| `DELETE` | `/vehicle-categories/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateVehicleCategoryDto` | `code`, `name`, `description`, `maxWeightKg`, `maxVolumenM3`, `baseCapacityNote`, `isActive?` |
| `UpdateVehicleCategoryDto` | Campos opcionales de `CreateVehicleCategoryDto` |

### Pricing

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/pricing/rate-cards` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/pricing/rate-cards` | `ADMIN` | Body `CreateRateCardDto` |
| `PATCH` | `/pricing/rate-cards/:id` | `ADMIN` | Path `id` UUID, body `UpdateRateCardDto` |
| `GET` | `/pricing/rate-cards/:id/rules` | `ADMIN`, `OPERATOR` | Path `id` UUID |
| `POST` | `/pricing/rate-cards/:id/rules` | `ADMIN` | Path `id` UUID, body `CreateRateRuleDto` |
| `POST` | `/pricing/quotes` | `CUSTOMER` | Body `CreatePriceQuoteDto` |
| `GET` | `/pricing/quotes/:id` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateRateCardDto` | `name`, `description`, `validFrom`, `validTo?`, `isActive?` |
| `UpdateRateCardDto` | Campos opcionales de `CreateRateCardDto` |
| `CreateRateRuleDto` | `vehicleCategoryId`, `baseFare`, `pricePerKm`, `pricePerMinute`, `minimumFare`, `helperFee`, `nightFee`, `waitingPricePerMinute`, `cancellationFee` |
| `CreatePriceQuoteDto` | `vehicleCategoryId`, `originAddress`, `destinationAddress`, `distanceKm`, `estimatedDurationMin`, `requireHelper?`, `nightService?` |

### Routes

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/routes/estimate` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Body `EstimateRouteDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `EstimateRouteDto` | `originAddress`, `originLatitude`, `originLongitude`, `destinationAddress`, `destinationLatitude`, `destinationLongitude` |

### Orders

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/orders` | `CUSTOMER` | Body `CreateOrderDto` |
| `GET` | `/orders` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Query `OrderQueryDto` |
| `GET` | `/orders/:id` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `id` UUID |
| `PATCH` | `/orders/:id/status` | `ADMIN`, `OPERATOR`, `DRIVER` | Path `id` UUID, body `UpdateOrderStatusDto` |
| `POST` | `/orders/:id/cancel` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Path `id` UUID, body `CancelOrderDto` |
| `GET` | `/orders/:id/events` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateOrderDto` | `quoteId`, `serviceType`, `scheduleAt?`, `notes?`, `stops[]`, `items[]` |
| `CreateOrderStopDto` | `stopType`, `sequence`, `contactName`, `contactPhone`, `addressLine`, `city`, `province`, `latitude`, `longitude`, `instructions?` |
| `CreateOrderItemDto` | `description`, `quantity`, `weightKg`, `volumeM3?`, `declaredValue?`, `fragile?`, `requireHelper?` |
| `OrderQueryDto` | `status?` |
| `UpdateOrderStatusDto` | `status` |
| `CancelOrderDto` | `cancellationType`, `reason` |

### Reservations

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/reservations` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/reservations` | `ADMIN`, `OPERATOR` | Body `CreateReservationDto` |
| `PATCH` | `/reservations/:id/reschedule` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `RescheduleReservationDto` |
| `PATCH` | `/reservations/:id/cancel` | `ADMIN`, `OPERATOR` | Path `id` UUID |
| `PATCH` | `/reservations/:id/complete` | `ADMIN`, `OPERATOR` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateReservationDto` | `orderId`, `reservedFor` |
| `RescheduleReservationDto` | `reservedFor` |

## Operations

### Drivers

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/drivers` | `ADMIN`, `OPERATOR` | Bearer token |
| `GET` | `/drivers/me` | `DRIVER` | Bearer token |
| `POST` | `/drivers` | `ADMIN`, `OPERATOR` | Body `CreateDriverDto` |
| `GET` | `/drivers/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID |
| `PATCH` | `/drivers/:id/status` | `ADMIN`, `OPERATOR`, `DRIVER` | Path `id` UUID, body `UpdateDriverStatusDto` |
| `PATCH` | `/drivers/:id/verification` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateDriverVerificationDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateDriverDto` | `userId`, `licenseNumber`, `licenseExpiration`, `availabilityStatus?`, `verificationStatus?` |
| `UpdateDriverStatusDto` | `availabilityStatus` |
| `UpdateDriverVerificationDto` | `verificationStatus` |

### Vehicles

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/vehicles` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/vehicles` | `ADMIN`, `OPERATOR` | Body `CreateVehicleDto` |
| `GET` | `/vehicles/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID |
| `PATCH` | `/vehicles/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateVehicleDto` |
| `GET` | `/vehicles/:id/documents` | `ADMIN`, `OPERATOR` | Path `id` UUID |
| `POST` | `/vehicles/:id/documents` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `CreateVehicleDocumentDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateVehicleDto` | `driverId`, `categoryId`, `plateNumber`, `brand`, `model`, `year`, `color`, `status?` |
| `UpdateVehicleDto` | Campos opcionales de `CreateVehicleDto` |
| `CreateVehicleDocumentDto` | `documentType`, `fileUrl`, `expirationDate`, `status?` |

### Assignments

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/assignments` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/assignments` | `ADMIN`, `OPERATOR` | Body `CreateAssignmentDto` |
| `PATCH` | `/assignments/:id/accept` | `DRIVER`, `ADMIN`, `OPERATOR` | Path `id` UUID |
| `PATCH` | `/assignments/:id/reject` | `DRIVER`, `ADMIN`, `OPERATOR` | Path `id` UUID |
| `PATCH` | `/assignments/:id/complete` | `ADMIN`, `OPERATOR` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateAssignmentDto` | `orderId`, `driverId`, `vehicleId` |

### Dispatch

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/dispatch/pending-orders` | `ADMIN`, `OPERATOR` | Bearer token |
| `GET` | `/dispatch/available-drivers` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/dispatch` | `ADMIN`, `OPERATOR` | Body `DispatchOrderDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `DispatchOrderDto` | `orderId`, `driverId`, `vehicleId` |

## Tracking

### Locations

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/locations` | `DRIVER`, `ADMIN`, `OPERATOR` | Body `CreateLocationDto` |
| `GET` | `/locations/orders/:orderId` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `orderId` UUID |
| `GET` | `/locations/orders/:orderId/latest` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `orderId` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateLocationDto` | `driverId`, `orderId`, `latitude`, `longitude`, `accuracy?`, `speed?`, `batteryLevel?`, `recordedAt?` |

### Trips

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/trips/start` | `DRIVER`, `ADMIN`, `OPERATOR` | Body `StartTripDto` |
| `PATCH` | `/trips/:id/end` | `DRIVER`, `ADMIN`, `OPERATOR` | Path `id` UUID |
| `GET` | `/trips/orders/:orderId` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `orderId` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `StartTripDto` | `orderId`, `driverId` |

### Order Events

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `POST` | `/order-events` | `ADMIN`, `OPERATOR`, `DRIVER` | Body `CreateOrderEventDto` |
| `GET` | `/order-events/orders/:orderId` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `orderId` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateOrderEventDto` | `orderId`, `eventType`, `description`, `metadata?`, `latitude?`, `longitude?` |

### ETA

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/eta/orders/:orderId` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `orderId` UUID |

## Billing

### Payments

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/payments` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/payments` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Body `CreatePaymentDto` |
| `GET` | `/payments/:id` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Path `id` UUID |
| `PATCH` | `/payments/:id/status` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdatePaymentStatusDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreatePaymentDto` | `orderId`, `paymentMethod`, `amount?`, `currency?` |
| `UpdatePaymentStatusDto` | `status`, `providerReference?` |

### Transactions

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/transactions` | `ADMIN`, `OPERATOR` | Query `paymentId?` |
| `POST` | `/transactions` | `ADMIN`, `OPERATOR` | Body `CreateTransactionDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateTransactionDto` | `paymentId`, `transactionType`, `amount`, `status`, `providerResponse?` |

### Refunds

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/refunds` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/refunds` | `ADMIN`, `OPERATOR` | Body `CreateRefundDto` |
| `PATCH` | `/refunds/:id/status` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateRefundStatusDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateRefundDto` | `paymentId`, `amount`, `reason` |
| `UpdateRefundStatusDto` | `status`, `providerReference?` |

### Cancellation Fees

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/cancellation-fees/orders/:orderId` | `ADMIN`, `OPERATOR`, `CUSTOMER` | Path `orderId` UUID |

### Webhooks

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/webhooks` | `ADMIN`, `OPERATOR` | Bearer token |
| `POST` | `/webhooks/internal` | Publico | Body `CreateWebhookEventDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateWebhookEventDto` | `eventType`, `externalEventId`, `payload` |

## Support

### Notifications

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/notifications/me` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Bearer token |
| `POST` | `/notifications` | `ADMIN`, `OPERATOR` | Body `CreateNotificationDto` |
| `PATCH` | `/notifications/:id/read` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `id` UUID |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateNotificationDto` | `userId`, `title`, `message`, `notificationType`, `data?` |

### Incidents

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/incidents` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Query `orderId?` |
| `POST` | `/incidents` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Body `CreateIncidentDto` |
| `PATCH` | `/incidents/:id/status` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateIncidentStatusDto` |
| `POST` | `/incidents/:id/comments` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Path `id` UUID, body `CreateIncidentCommentDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateIncidentDto` | `orderId`, `incidentType`, `severity`, `title`, `description`, `latitude`, `longitude` |
| `CreateIncidentCommentDto` | `comment` |
| `UpdateIncidentStatusDto` | `status` |

### Attachments

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/attachments` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Query `entityType?`, `entityId?` |
| `POST` | `/attachments` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Body `CreateAttachmentDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateAttachmentDto` | `entityType`, `entityId`, `fileName`, `fileUrl`, `fileSize`, `mimeType` |

### Delivery Proofs

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/delivery-proofs` | `ADMIN`, `OPERATOR`, `CUSTOMER`, `DRIVER` | Query `orderId?` |
| `POST` | `/delivery-proofs` | `DRIVER`, `ADMIN`, `OPERATOR` | Body `CreateDeliveryProofDto` |
| `PATCH` | `/delivery-proofs/:id/validate` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `ValidateDeliveryProofDto` |
| `POST` | `/delivery-proofs/:id/signatures` | `DRIVER`, `ADMIN`, `OPERATOR` | Path `id` UUID, body `CreateSignatureDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateDeliveryProofDto` | `orderId`, `proofType`, `recipientName`, `recipientDocument`, `notes?`, `latitude`, `longitude` |
| `CreateSignatureDto` | `signatureUrl`, `signerName` |
| `ValidateDeliveryProofDto` | `validationStatus` |

## Administration

### Dashboard

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/dashboard/summary` | `ADMIN`, `OPERATOR` | Bearer token |

### Reports

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/reports/operations` | `ADMIN`, `OPERATOR` | Bearer token |
| `GET` | `/reports/billing` | `ADMIN`, `OPERATOR` | Bearer token |

### Catalogs

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/catalogs` | `ADMIN`, `OPERATOR` | Query `groupKey?` |
| `POST` | `/catalogs` | `ADMIN`, `OPERATOR` | Body `CreateCatalogDto` |
| `PATCH` | `/catalogs/:id` | `ADMIN`, `OPERATOR` | Path `id` UUID, body `UpdateCatalogDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `CreateCatalogDto` | `groupKey`, `code`, `label`, `sortOrder?`, `isActive?` |
| `UpdateCatalogDto` | Campos opcionales de `CreateCatalogDto` |

### Parameters

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/parameters` | `ADMIN` | Bearer token |
| `PUT` | `/parameters` | `ADMIN` | Body `UpsertParameterDto` |

DTOs principales:

| DTO | Campos |
| --- | --- |
| `UpsertParameterDto` | `key`, `value`, `valueType`, `description` |

### Audit

| Metodo | Ruta | Acceso | Request |
| --- | --- | --- | --- |
| `GET` | `/audit` | `ADMIN` | Query `actorUserId?`, `entityType?`, `entityId?`, `action?` |
