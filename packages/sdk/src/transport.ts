import {
  FramekitAuthenticationError,
  FramekitAuthorizationError,
  FramekitCancelledError,
  FramekitConflictError,
  FramekitNotFoundError,
  FramekitProtocolError,
  FramekitRateLimitError,
  FramekitResponseError,
  FramekitSdkError,
  FramekitServerError,
  FramekitTransportError,
  FramekitValidationError
} from "./errors.js";
import type { FramekitRetryPolicy } from "./types.js";

export function normalizeRetryPolicy(policy: FramekitRetryPolicy | undefined): Required<FramekitRetryPolicy> | undefined {
  if (!policy) return undefined;
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 5) {
    throw new Error("retry.maxAttempts must be an integer between 1 and 5.");
  }
  const baseDelayMs = policy.baseDelayMs ?? 100;
  const maxDelayMs = policy.maxDelayMs ?? 5_000;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new Error("Retry delays must be finite, non-negative, and maxDelayMs must be at least baseDelayMs.");
  }
  return { maxAttempts: policy.maxAttempts, baseDelayMs, maxDelayMs };
}

export function isRetrySafe(method: string, headers: Record<string, string>): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) || Boolean(headers["idempotency-key"]);
}

export function isRetryable(error: FramekitSdkError): boolean {
  return error instanceof FramekitTransportError || error instanceof FramekitRateLimitError || [408, 425, 500, 502, 503, 504].includes(error.status ?? 0);
}

export function toFramekitSdkError(cause: unknown, signal?: AbortSignal): FramekitSdkError {
  if (cause instanceof FramekitSdkError) return cause;
  if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) return cancelledError(signal?.reason ?? cause);
  const candidate = cause as { response?: { status?: number; headers?: Headers; _data?: unknown }; data?: unknown; message?: string };
  const status = candidate.response?.status;
  const payload = (candidate.response?._data ?? candidate.data) as { code?: unknown; message?: unknown; details?: unknown } | undefined;
  const code = typeof payload?.code === "string" ? payload.code : status ? `HTTP_${status}` : "TRANSPORT_ERROR";
  const message = typeof payload?.message === "string" ? payload.message : candidate.message ?? "Framekit request failed.";
  const requestId = candidate.response?.headers?.get("x-request-id") ?? undefined;
  const retryAfterMs = parseRetryAfter(candidate.response?.headers?.get("retry-after"));
  const args = [message, code, status, payload?.details, requestId, retryAfterMs, { cause }] as const;
  if (status === 400 || status === 422) return new FramekitValidationError(...args);
  if (status === 401) return new FramekitAuthenticationError(...args);
  if (status === 403) return new FramekitAuthorizationError(...args);
  if (status === 404) return new FramekitNotFoundError(...args);
  if (status === 409) return new FramekitConflictError(...args);
  if (status === 429) return new FramekitRateLimitError(...args);
  if (status && status >= 500) return new FramekitServerError(...args);
  if (candidate.response) return new FramekitResponseError(...args);
  return new FramekitTransportError(...args);
}

export async function responseToSdkError(response: Response, signal?: AbortSignal): Promise<FramekitSdkError> {
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return toFramekitSdkError(cause, signal);
  }
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text ? { message: text } : undefined;
  }
  return toFramekitSdkError({
    message: text || `Framekit request failed with HTTP ${response.status}.`,
    response: { status: response.status, headers: response.headers, _data: data }
  }, signal);
}

export function cancelledError(reason: unknown): FramekitCancelledError {
  return new FramekitCancelledError("Framekit request was cancelled.", "REQUEST_CANCELLED", undefined, reason, undefined, undefined, { cause: reason });
}

export function streamReadError(cause: unknown, response: Response, signal?: AbortSignal): FramekitSdkError {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) {
    const reason = signal?.reason ?? cause;
    return new FramekitCancelledError("Framekit request was cancelled.", "REQUEST_CANCELLED", response.status, reason, requestId, undefined, { cause });
  }
  return new FramekitTransportError(cause instanceof Error ? cause.message : "Realtime stream read failed.", "STREAM_READ_FAILED", response.status, undefined, requestId, undefined, { cause });
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelledError(signal.reason));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseSseChunk(chunk: string, response?: Response): { id?: string; type: string; data: unknown } | undefined {
  const id = chunk.split("\n").find((line) => line.startsWith("id: "))?.slice("id: ".length);
  const type = chunk.split("\n").find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "message";
  const data = chunk.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
  if (!data) {
    return undefined;
  }
  try {
    return { ...(id ? { id } : {}), type, data: JSON.parse(data) as unknown };
  } catch (cause) {
    throw new FramekitProtocolError("Realtime event data is not valid JSON.", "SSE_INVALID_JSON", response?.status, { eventId: id, eventType: type }, response?.headers.get("x-request-id") ?? undefined, undefined, { cause });
  }
}
