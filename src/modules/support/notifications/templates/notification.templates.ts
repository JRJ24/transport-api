import { NOTIFICATION_TYPE } from '@generated/prisma/enums';

/**
 * Logical, domain-level notification events. The stable `type` is sent inside
 * the push `data` payload; the mobile app validates it before navigating.
 */
export type NotificationEvent =
  | 'ORDER_CREATED'
  | 'ORDER_ASSIGNED'
  | 'ORDER_REASSIGNED'
  | 'ORDER_CANCELLED'
  | 'ORDER_STATUS_CHANGED'
  | 'SCHEDULE_CHANGED'
  | 'PICKUP_SOON'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED'
  | 'OPERATOR_MESSAGE'
  | 'DOCUMENT_EXPIRING'
  | 'SESSION_CLOSED'
  | 'TEST';

export interface NotificationTemplate {
  category: NOTIFICATION_TYPE;
  title: string;
  message: string;
  /** Safe navigation payload. Values are strings (FCM data must be strings). */
  data: Record<string, string>;
}

export interface TemplateContext {
  orderId?: string;
  orderCode?: string;
  status?: string;
  message?: string;
  incidentId?: string;
  scheduleAt?: string;
  [key: string]: string | undefined;
}

type Builder = (ctx: TemplateContext) => NotificationTemplate;

const dropUndefined = (
  data: Record<string, string | undefined>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

const TEMPLATES: Record<NotificationEvent, Builder> = {
  ORDER_CREATED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Nueva orden en TMS',
    message: `La orden ${ctx.orderCode ?? ''} está lista para despacho`.trim(),
    data: dropUndefined({
      type: 'ORDER_CREATED',
      screen: 'orders',
      orderId: ctx.orderId,
      orderCode: ctx.orderCode,
    }),
  }),
  ORDER_ASSIGNED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Nueva orden asignada',
    message: `Tienes una nueva orden ${ctx.orderCode ?? ''}`.trim(),
    data: dropUndefined({
      type: 'ORDER_ASSIGNED',
      screen: 'order-detail',
      orderId: ctx.orderId,
      orderCode: ctx.orderCode,
    }),
  }),
  ORDER_REASSIGNED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Orden reasignada',
    message: `La orden ${ctx.orderCode ?? ''} fue reasignada`.trim(),
    data: dropUndefined({
      type: 'ORDER_REASSIGNED',
      screen: 'orders',
      orderId: ctx.orderId,
    }),
  }),
  ORDER_CANCELLED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Orden cancelada',
    message: `La orden ${ctx.orderCode ?? ''} fue cancelada`.trim(),
    data: dropUndefined({
      type: 'ORDER_CANCELLED',
      screen: 'orders',
      orderId: ctx.orderId,
    }),
  }),
  ORDER_STATUS_CHANGED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Estado de la orden actualizado',
    message:
      `La orden ${ctx.orderCode ?? ''} cambió a ${ctx.status ?? ''}`.trim(),
    data: dropUndefined({
      type: 'ORDER_STATUS_CHANGED',
      screen: 'order-detail',
      orderId: ctx.orderId,
      status: ctx.status,
    }),
  }),
  SCHEDULE_CHANGED: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Cambio de horario',
    message:
      `Se actualizó el horario de la orden ${ctx.orderCode ?? ''}`.trim(),
    data: dropUndefined({
      type: 'SCHEDULE_CHANGED',
      screen: 'order-detail',
      orderId: ctx.orderId,
      scheduleAt: ctx.scheduleAt,
    }),
  }),
  PICKUP_SOON: (ctx) => ({
    category: NOTIFICATION_TYPE.ORDER_UPDATE,
    title: 'Recogida próxima',
    message:
      `Prepárate para la recogida de la orden ${ctx.orderCode ?? ''}`.trim(),
    data: dropUndefined({
      type: 'PICKUP_SOON',
      screen: 'order-detail',
      orderId: ctx.orderId,
    }),
  }),
  INCIDENT_CREATED: (ctx) => ({
    category: NOTIFICATION_TYPE.INCIDENT,
    title: 'Nueva incidencia operativa',
    message: ctx.message ?? 'Se reportó una nueva incidencia',
    data: dropUndefined({
      type: 'INCIDENT_CREATED',
      screen: 'incidents',
      orderId: ctx.orderId,
      incidentId: ctx.incidentId,
    }),
  }),
  INCIDENT_UPDATED: (ctx) => ({
    category: NOTIFICATION_TYPE.INCIDENT,
    title: 'Incidencia actualizada',
    message: ctx.message ?? 'Una incidencia fue actualizada',
    data: dropUndefined({
      type: 'INCIDENT_UPDATED',
      screen: 'order-detail',
      orderId: ctx.orderId,
      incidentId: ctx.incidentId,
    }),
  }),
  OPERATOR_MESSAGE: (ctx) => ({
    category: NOTIFICATION_TYPE.SYSTEM,
    title: 'Mensaje del operador',
    message: ctx.message ?? 'Tienes un mensaje del centro de operaciones',
    data: dropUndefined({ type: 'OPERATOR_MESSAGE', screen: 'notifications' }),
  }),
  DOCUMENT_EXPIRING: (ctx) => ({
    category: NOTIFICATION_TYPE.SYSTEM,
    title: 'Documento próximo a vencer',
    message: ctx.message ?? 'Un documento está próximo a vencer',
    data: dropUndefined({ type: 'DOCUMENT_EXPIRING', screen: 'profile' }),
  }),
  SESSION_CLOSED: () => ({
    category: NOTIFICATION_TYPE.SYSTEM,
    title: 'Sesión cerrada por seguridad',
    message: 'Tu sesión fue cerrada. Inicia sesión nuevamente.',
    data: { type: 'SESSION_CLOSED', screen: 'login' },
  }),
  TEST: (ctx) => ({
    category: NOTIFICATION_TYPE.SYSTEM,
    title: 'Notificación de prueba',
    message: ctx.message ?? 'RUTA RD Driver — notificación de prueba',
    data: dropUndefined({
      type: 'TEST',
      screen: 'notifications',
      orderId: ctx.orderId,
    }),
  }),
};

export function buildTemplate(
  event: NotificationEvent,
  ctx: TemplateContext = {},
): NotificationTemplate {
  return TEMPLATES[event](ctx);
}
