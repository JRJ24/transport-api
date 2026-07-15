import { registerAs } from '@nestjs/config';

export const mapsConfig = registerAs('maps', () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
}));
