export class FramekitSdkError extends Error {
  constructor(message: string, readonly code: string, readonly status: number | undefined, readonly details: unknown, readonly requestId: string | undefined, readonly retryAfterMs: number | undefined, options?: ErrorOptions) { super(message, options); this.name = new.target.name; }
}
export class FramekitValidationError extends FramekitSdkError {}
export class FramekitAuthenticationError extends FramekitSdkError {}
export class FramekitAuthorizationError extends FramekitSdkError {}
export class FramekitNotFoundError extends FramekitSdkError {}
export class FramekitConflictError extends FramekitSdkError {}
export class FramekitRateLimitError extends FramekitSdkError {}
export class FramekitServerError extends FramekitSdkError {}
export class FramekitResponseError extends FramekitSdkError {}
export class FramekitTransportError extends FramekitSdkError {}
export class FramekitProtocolError extends FramekitSdkError {}
export class FramekitCancelledError extends FramekitSdkError {}
