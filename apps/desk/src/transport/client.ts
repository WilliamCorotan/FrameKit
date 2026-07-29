const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "http://localhost:3000";

export type RequestOptions = { method?: string; body?: unknown; expectedRevision?: number };

type AuthRequestState = { generation: number; controller: AbortController };

let authRequestState: AuthRequestState = { generation: 0, controller: new AbortController() };

/** Invalidates every request belonging to the previous browser session. */
export function beginAuthGeneration() {
  authRequestState.controller.abort();
  authRequestState = { generation: authRequestState.generation + 1, controller: new AbortController() };
}

/** Ends the server session independently so a new auth generation cannot cancel revocation. */
export async function requestLogout(): Promise<void> {
  await fetch(apiUrl + "/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": "default" },
    credentials: "include"
  });
}

function staleRequest<T>(): Promise<T> {
  return new Promise(() => undefined);
}

export async function fetchJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const requestGeneration = authRequestState.generation;
  const requestController = authRequestState.controller;
  const headers: Record<string, string> = { "content-type": "application/json", "x-tenant-id": "default" };
  if (options.expectedRevision !== undefined) headers["if-match"] = String(options.expectedRevision);

  let response: Response;
  try {
    response = await fetch(apiUrl + path, {
      method: options.method ?? "GET",
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers,
      credentials: "include",
      signal: requestController.signal
    });
  } catch (error) {
    if (requestGeneration !== authRequestState.generation) return staleRequest<T>();
    throw error;
  }

  if (requestGeneration !== authRequestState.generation) return staleRequest<T>();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/me" && path !== "/api/auth/login") {
      window.dispatchEvent(new Event("framekit:unauthenticated"));
    }
    const text = await response.text();
    if (requestGeneration !== authRequestState.generation) return staleRequest<T>();
    try {
      const payload = JSON.parse(text) as { message?: unknown };
      throw new Error(typeof payload.message === "string" ? payload.message : `Request failed (${response.status}).`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text || `Request failed (${response.status}).`);
      throw error;
    }
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json() as T;
  return requestGeneration === authRequestState.generation ? payload : staleRequest<T>();
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Request failed. Try again."; }
export function encodeBase64(bytes: Uint8Array): string { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
export function csv(value: string | undefined): string[] { return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []; }
