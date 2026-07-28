import { FramekitSdkError } from "@framekit/sdk";

export function describeError(error: unknown): string {
  if (error instanceof FramekitSdkError) {
    const request = error.requestId ? ` Request: ${error.requestId}.` : "";
    return `${error.code}${error.status ? ` (${error.status})` : ""}: ${error.message}.${request}`;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
