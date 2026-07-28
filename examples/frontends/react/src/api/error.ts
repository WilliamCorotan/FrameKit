import { FramekitSdkError } from "@framekit/sdk";

export function describeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof FramekitSdkError) {
    return `${error.name} · ${error.code}${error.status ? ` · HTTP ${error.status}` : ""}${error.requestId ? ` · request ${error.requestId}` : ""}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "An unknown error interrupted the request.";
}
