const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "http://localhost:3000";

export type RequestOptions = { method?: string; body?: unknown; token?: string; expectedRevision?: number };

export async function fetchJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-tenant-id": "default" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.expectedRevision !== undefined) headers["if-match"] = String(options.expectedRevision);
  const response = await fetch(apiUrl + path, { method: options.method ?? "GET", body: options.body ? JSON.stringify(options.body) : undefined, headers });
  if (!response.ok) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as { message?: unknown };
      throw new Error(typeof payload.message === "string" ? payload.message : `Request failed (${response.status}).`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text || `Request failed (${response.status}).`);
      throw error;
    }
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Request failed. Try again."; }
export function encodeBase64(bytes: Uint8Array): string { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
export function csv(value: string | undefined): string[] { return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []; }
