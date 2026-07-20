/**
 * Raised when the Google Routes provider fails. Carries a safe, user-facing
 * message plus optional provider metadata for logging only (never serialized to
 * the client). Mapped by the service to a NestJS ServiceUnavailableException.
 */
export class GoogleRoutesError extends Error {
  constructor(
    message: string,
    readonly providerStatus?: number,
    readonly providerDetail?: unknown,
  ) {
    super(message);
    this.name = 'GoogleRoutesError';
  }
}
