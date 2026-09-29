import { cellToParent, getResolution, gridDisk, latLngToCell } from 'h3-js';
import type { LatLng } from '@/integrations/google-maps/interfaces/route.interface';

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance between two coordinates, in metres. The single copy of
 * the formula: routing fallbacks, GPS anomaly checks and candidate
 * pre-selection all call this one.
 */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRad(to.latitude - from.latitude);
  const deltaLng = toRad(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Rough bounding box of the Dominican Republic, padded. Presence outside it is
 * a bad fix or a spoofed device, never a driver we can dispatch.
 */
const DR_BOUNDS = { minLat: 17.3, maxLat: 20.1, minLng: -72.1, maxLng: -68.2 };

export function isInServiceArea(point: LatLng): boolean {
  return (
    point.latitude >= DR_BOUNDS.minLat &&
    point.latitude <= DR_BOUNDS.maxLat &&
    point.longitude >= DR_BOUNDS.minLng &&
    point.longitude <= DR_BOUNDS.maxLng
  );
}

/** H3 cell of a coordinate. H3 indexes space; it does not measure roads. */
export function h3CellOf(point: LatLng, resolution: number): string {
  return latLngToCell(point.latitude, point.longitude, resolution);
}

/** Cells exactly `ring` steps away from `cell` (ring 0 is the cell itself). */
export function h3Ring(cell: string, ring: number): string[] {
  if (ring === 0) {
    return [cell];
  }
  const inner = new Set(gridDisk(cell, ring - 1));
  return gridDisk(cell, ring).filter((candidate) => !inner.has(candidate));
}

/** Parent of `cell` at a coarser resolution (identity when already there). */
export function h3ParentOf(cell: string, resolution: number): string {
  return getResolution(cell) <= resolution
    ? cell
    : cellToParent(cell, resolution);
}
