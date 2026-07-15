const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Converts durations like "15m", "7d" or "900s" to milliseconds.
 */
export function durationToMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration.trim());

  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}" (expected e.g. "15m", "30d")`,
    );
  }

  return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
}

export function durationToSeconds(duration: string): number {
  return Math.floor(durationToMs(duration) / 1_000);
}

export function addDuration(date: Date, duration: string): Date {
  return new Date(date.getTime() + durationToMs(duration));
}
