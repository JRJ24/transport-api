/**
 * Matching Google's Dominican place names against our own catalog.
 *
 * `prisma/dominican-territories.ts` stores names without diacritics
 * ("Dajabon", "Monsenor Nouel", "El Penon") while Google answers with them
 * ("Dajabón", "Monseñor Nouel"). Normalizing both sides removes most of the
 * mismatch; the alias table covers the handful where the two simply use
 * different names.
 */

const PREFIXES = [
  'provincia de ',
  'provincia ',
  'municipio de ',
  'municipio ',
  'distrito municipal de ',
  'distrito municipal ',
];

/** Lowercase, unaccented, prefix-free form used for every comparison. */
export function normalizeTerritory(value: string): string {
  let result = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  for (const prefix of PREFIXES) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length).trim();
      break;
    }
  }

  return result;
}

/**
 * Normalized Google name -> normalized catalog name, for the cases the
 * normalizer cannot bridge on its own.
 */
const TERRITORY_ALIASES: Record<string, string> = {
  // Google calls the capital's municipality "Santo Domingo"; the catalog
  // registers it under its formal name.
  'santo domingo': 'santo domingo de guzman',
  'santo domingo de guzman (distrito nacional)': 'santo domingo de guzman',
  // Google alternates between both official spellings of the province.
  baoruco: 'bahoruco',
  'san pedro de macoris': 'san pedro de macoris',
  'gran santo domingo': 'santo domingo',
};

export function canonicalTerritory(value: string): string {
  const normalized = normalizeTerritory(value);
  return TERRITORY_ALIASES[normalized] ?? normalized;
}

/**
 * Best catalog entry for a name Google returned.
 *
 * `exact` means the normalized names matched outright, `alias` that the lookup
 * table bridged them; callers use the distinction to decide whether to fall
 * back to matching against the formatted address.
 */
export function matchTerritory<T extends { id: string; name: string }>(
  candidate: string | null | undefined,
  options: T[],
): { match: T; confidence: 'exact' | 'alias' } | null {
  if (!candidate) {
    return null;
  }

  const normalized = normalizeTerritory(candidate);
  const exact = options.find(
    (option) => normalizeTerritory(option.name) === normalized,
  );

  if (exact) {
    return { match: exact, confidence: 'exact' };
  }

  const canonical = TERRITORY_ALIASES[normalized];
  if (!canonical) {
    return null;
  }

  const aliased = options.find(
    (option) => normalizeTerritory(option.name) === canonical,
  );

  return aliased ? { match: aliased, confidence: 'alias' } : null;
}
