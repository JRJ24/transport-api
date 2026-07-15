import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { databaseConfig } from './database.config';
import { mapsConfig } from './maps.config';
import { notificationConfig } from './notification.config';
import { paymentConfig } from './payment.config';
import { storageConfig } from './storage.config';

export * from './app.config';
export * from './auth.config';
export * from './database.config';
export * from './env.validation';
export * from './maps.config';
export * from './notification.config';
export * from './payment.config';
export * from './storage.config';

export const configLoaders = [
  appConfig,
  authConfig,
  databaseConfig,
  mapsConfig,
  notificationConfig,
  paymentConfig,
  storageConfig,
];
