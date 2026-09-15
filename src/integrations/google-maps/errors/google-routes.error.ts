/**
 * Why a Routes API call did not produce a route.
 *
 * `no-route` is a business outcome (Google answered fine, the two stops are
 * simply not connected by road); everything else is an outage on the provider
 * side. Keeping them apart is what lets the HTTP layer answer 422 instead of
 * 503 for the first one.
 */
export type GoogleRoutesFailure =
  'provider-error' | 'provider-denied' | 'provider-timeout' | 'no-route';

/**
 * Raised when the Google Routes provider fails. Carries a safe, user-facing
 * message plus optional provider metadata for logging only (never serialized to
 * the client).
 *
 * Mapped to an HTTP response by `GoogleRoutesExceptionFilter`. The mapping
 * lives in a filter, not here, so this integration stays framework-agnostic and
 * usable from non-HTTP contexts (jobs, gateways).
 */
export class GoogleRoutesError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
    readonly providerDetail?: unknown,
    readonly reason: GoogleRoutesFailure = 'provider-error',
  ) {
    super(message);
    this.name = 'GoogleRoutesError';
  }

  static noRoute(): GoogleRoutesError {
    return new GoogleRoutesError(
      'No drivable route between the given stops',
      undefined,
      undefined,
      'no-route',
    );
  }
}
