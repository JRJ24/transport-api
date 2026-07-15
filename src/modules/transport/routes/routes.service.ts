import { Injectable } from '@nestjs/common';
import type { EstimateRouteDto } from './dto/estimate-route.dto';

@Injectable()
export class RoutesService {
  estimate(dto: EstimateRouteDto): {
    originAddress: string;
    destinationAddress: string;
    distanceKm: number;
    estimatedDurationMin: number;
    provider: 'internal-mock';
  } {
    const distanceKm = this.haversineKm(
      dto.originLatitude,
      dto.originLongitude,
      dto.destinationLatitude,
      dto.destinationLongitude,
    );

    return {
      originAddress: dto.originAddress,
      destinationAddress: dto.destinationAddress,
      distanceKm,
      estimatedDurationMin: Math.max(Math.round((distanceKm / 30) * 60), 1),
      provider: 'internal-mock',
    };
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const earthRadiusKm = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return Number(
      (earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(
        2,
      ),
    );
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }
}
