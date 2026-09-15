import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { TtlCache } from '@/common/utils/ttl-cache.util';
import {
  matchTerritory,
  normalizeTerritory,
} from '@/common/utils/territory.util';

export interface TerritoryResolution {
  provinceId: string | null;
  provinceName: string | null;
  municipalityId: string | null;
  municipalityName: string | null;
  /**
   * How the province was matched. `none` tells the client to fall back to
   * matching the formatted address itself.
   */
  confidence: 'exact' | 'alias' | 'none';
}

interface TerritoryCatalog {
  provinces: { id: string; name: string }[];
  municipalitiesByProvince: Map<string, { id: string; name: string }[]>;
}

/** 32 provinces and ~158 municipalities that change roughly never. */
const CATALOG_TTL_MS = 30 * 60 * 1000;

/**
 * Turns the province and municipality names Google returns into the catalog ids
 * the order form's selects need.
 *
 * Doing this server-side keeps the name normalization in one place: the seed
 * data is unaccented and Google's output is not, and the clients used to paper
 * over that by searching for catalog names inside the formatted address, which
 * silently failed whenever Google phrased the address differently.
 */
@Injectable()
export class TerritoryMatchService {
  private readonly cache = new TtlCache<TerritoryCatalog>(CATALOG_TTL_MS, 1);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    province?: string;
    municipality?: string;
  }): Promise<TerritoryResolution> {
    const catalog = await this.loadCatalog();
    const province = matchTerritory(input.province, catalog.provinces);

    if (!province) {
      return {
        provinceId: null,
        provinceName: null,
        municipalityId: null,
        municipalityName: null,
        confidence: 'none',
      };
    }

    // Scoping the municipality lookup to the province removes the duplicate
    // names the country has across provinces.
    const municipalities =
      catalog.municipalitiesByProvince.get(province.match.id) ?? [];
    const municipality =
      matchTerritory(input.municipality, municipalities) ??
      // Google often reports the province name as the locality for the
      // single-municipality provinces; try the province name as a last resort.
      matchTerritory(province.match.name, municipalities);

    return {
      provinceId: province.match.id,
      provinceName: province.match.name,
      municipalityId: municipality?.match.id ?? null,
      municipalityName: municipality?.match.name ?? null,
      confidence: province.confidence,
    };
  }

  private async loadCatalog(): Promise<TerritoryCatalog> {
    const cached = this.cache.get('catalog');

    if (cached) {
      return cached;
    }

    const [provinces, municipalities] = await Promise.all([
      this.prisma.province.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.municipality.findMany({
        where: { isActive: true },
        select: { id: true, name: true, provinceId: true },
      }),
    ]);

    const municipalitiesByProvince = new Map<
      string,
      { id: string; name: string }[]
    >();

    for (const municipality of municipalities) {
      const bucket =
        municipalitiesByProvince.get(municipality.provinceId) ?? [];
      bucket.push({ id: municipality.id, name: municipality.name });
      municipalitiesByProvince.set(municipality.provinceId, bucket);
    }

    const catalog: TerritoryCatalog = {
      provinces,
      municipalitiesByProvince,
    };

    this.cache.set('catalog', catalog);
    return catalog;
  }

  /** Exposed for the seed/admin tooling that edits territories. */
  invalidate(): void {
    this.cache.clear();
  }
}

export { normalizeTerritory };
