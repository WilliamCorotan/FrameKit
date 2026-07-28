import { ofetch } from "ofetch";
import type { AppDefinition, AttachmentMetadata, DocumentCommandOperation, DocumentData, DocumentRecord, OwnerTransferReceipt, TenantContext } from "@framekit/core";
import {
  FramekitCancelledError,
  FramekitProtocolError,
  FramekitSdkError,
  FramekitTransportError
} from "./errors.js";
import {
  abortableDelay,
  cancelledError,
  isRetrySafe,
  isRetryable,
  normalizeRetryPolicy,
  parseSseChunk,
  responseToSdkError,
  streamReadError,
  toFramekitSdkError
} from "./transport.js";
import type {
  ApiToken,
  AttachmentDownload,
  AuthAuditEvent,
  AuthRole,
  AuthUser,
  CreatedApiToken,
  DependencyHealthResponse,
  DocumentCommandResult,
  FramekitClientOptions,
  FramekitConfigUpgradeDiagnostic,
  FramekitConfigUpgradeResult,
  FramekitRetryPolicy,
  FramekitRequestOptions,
  HealthResponse,
  IssuedLifecycleToken,
  ListDocumentsOptions,
  ListDocumentsPage,
  MigrationPlan,
  MigrationRecord,
  MutationRequestOptions
} from "./types.js";

export class FramekitClient {
  private readonly baseUrl: string;
  private readonly tenant: Partial<TenantContext>;
  private readonly authMode: "bearer" | "cookie";
  private readonly credentials?: RequestCredentials;
  private readonly retry?: Required<FramekitRetryPolicy>;
  private token?: string;

  constructor(options: FramekitClientOptions) {
    const { config } = upgradeFramekitClientConfig(options);
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.tenant = config.tenant ?? {};
    this.authMode = config.authMode ?? "bearer";
    this.credentials = config.credentials ?? (this.authMode === "cookie" ? "include" : undefined);
    this.token = config.token;
    this.retry = normalizeRetryPolicy(config.retry);
  }

  health(options: FramekitRequestOptions = {}): Promise<HealthResponse> {
    return this.request("/health/live", { skipAuth: true, signal: options.signal });
  }

  dependencyHealth(options: FramekitRequestOptions = {}): Promise<DependencyHealthResponse> {
    return this.request("/health/ready", { skipAuth: true, signal: options.signal });
  }

  meta<T = unknown>(options: { locale?: string } = {}): Promise<T> {
    return this.request(`/api/meta${options.locale ? `?locale=${encodeURIComponent(options.locale)}` : ""}`);
  }

  settings<T = unknown>(options: { locale?: string } = {}): Promise<T> {
    return this.request(`/api/settings${options.locale ? `?locale=${encodeURIComponent(options.locale)}` : ""}`);
  }

  upsertSetting<T = unknown>(key: string, value: unknown): Promise<T> {
    return this.request(`/api/settings/${encodeURIComponent(key)}`, { method: "PUT", body: { value } });
  }

  diagnostics<T = unknown>(): Promise<T> {
    return this.request("/api/diagnostics");
  }

  migrations(): Promise<MigrationRecord[]> {
    return this.request("/api/migrations");
  }

  realtimeEvents<T = unknown>(options: { limit?: number; after?: string } = {}): Promise<T> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.after !== undefined) query.set("after", options.after);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.request(`/api/realtime/events${suffix}`);
  }

  async streamRealtimeEvents(
    onEvent: (event: { id?: string; type: string; data: unknown }) => void,
    options: { signal?: AbortSignal; lastEventId?: string } = {}
  ): Promise<void> {
    if (options.signal?.aborted) throw cancelledError(options.signal.reason);
    let response: Response;
    try {
      response = await fetch(this.baseUrl + "/api/realtime/stream", {
        headers: { ...this.headers(), ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}) },
        credentials: this.credentials,
        signal: options.signal
      });
    } catch (cause) {
      throw toFramekitSdkError(cause, options.signal);
    }
    if (!response.ok) throw await responseToSdkError(response, options.signal);
    if (!response.body) throw new FramekitProtocolError("Realtime response did not include a stream body.", "SSE_BODY_MISSING", response.status, undefined, response.headers.get("x-request-id") ?? undefined, undefined);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (cause) {
        throw streamReadError(cause, response, options.signal);
      }
      const { done, value } = result;
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = parseSseChunk(chunk, response);
        if (event) {
          onEvent(event);
        }
      }
    }
  }

  planMigration(app: AppDefinition): Promise<MigrationPlan> {
    return this.request("/api/migrations/plan", { method: "POST", body: { app } });
  }

  applyMigration(plan: MigrationPlan, options: { allowDestructive?: boolean; signal?: AbortSignal } = {}): Promise<MigrationRecord> {
    return this.request("/api/migrations/apply", { method: "POST", body: { plan, allowDestructive: options.allowDestructive }, signal: options.signal });
  }

  openapi<T = unknown>(): Promise<T> {
    return this.request("/api/openapi.json");
  }

  audit<T = unknown>(): Promise<T> {
    return this.request("/api/audit");
  }

  outbox<T = unknown>(): Promise<T> {
    return this.request("/api/outbox");
  }

  markOutboxDispatched<T = unknown>(id: string): Promise<T> {
    return this.request(`/api/outbox/${id}/dispatch`, { method: "POST" });
  }

  markOutboxFailed<T = unknown>(id: string, error: string): Promise<T> {
    return this.request(`/api/outbox/${id}/fail`, { method: "POST", body: { error } });
  }

  customFields<T = unknown>(): Promise<T> {
    return this.request("/api/custom-fields");
  }

  addCustomField<T = unknown>(doctype: string, field: Record<string, unknown>): Promise<T> {
    return this.request("/api/custom-fields", { method: "POST", body: { doctype, field } });
  }

  views<T = unknown>(): Promise<T> {
    return this.request("/api/views");
  }

  upsertView<T = unknown>(doctype: string, type: "list" | "form", fields: string[]): Promise<T> {
    return this.request("/api/views", { method: "POST", body: { doctype, type, fields } });
  }

  async login<T = { token: string }>(email: string, password: string): Promise<T> {
    const session = await this.request<T>("/api/auth/login", { method: "POST", body: { email, password }, skipAuth: true });
    if (typeof session === "object" && session && "token" in session && typeof session.token === "string") {
      this.token = session.token;
    }
    return session;
  }

  async loginWithProvider<T = { token: string }>(providerId: string, token: string): Promise<T> {
    const session = await this.request<T>(`/api/auth/providers/${providerId}/login`, { method: "POST", body: { token }, skipAuth: true });
    if (typeof session === "object" && session && "token" in session && typeof session.token === "string") {
      this.token = session.token;
    }
    return session;
  }

  providerAuthorizationUrl(providerId: string, returnTo = "/"): string {
    const query = new URLSearchParams({ returnTo });
    return `${this.baseUrl}/api/auth/providers/${encodeURIComponent(providerId)}/authorize?${query}`;
  }

  createInvitation(input: { email: string; name: string; roles: string[]; permissions: string[]; expiresAt?: string }): Promise<IssuedLifecycleToken> {
    return this.request("/api/auth/invitations", { method: "POST", body: input });
  }

  linkProviderIdentity(input: { providerId: string; subject: string; userId: string; email?: string }): Promise<unknown> {
    return this.request("/api/auth/identity-links", { method: "POST", body: input });
  }

  acceptInvitation(token: string, password: string): Promise<{ token: string }> {
    return this.request("/api/auth/invitations/accept", { method: "POST", body: { token, password }, skipAuth: true });
  }

  requestPasswordReset(email: string): Promise<{ accepted: true }> {
    return this.request("/api/auth/password/reset/request", { method: "POST", body: { email }, skipAuth: true });
  }

  completePasswordReset(token: string, newPassword: string): Promise<void> {
    return this.request("/api/auth/password/reset/complete", { method: "POST", body: { token, newPassword }, skipAuth: true });
  }

  createRecoveryToken(userId: string): Promise<IssuedLifecycleToken> {
    return this.request(`/api/auth/users/${userId}/recovery`, { method: "POST" });
  }

  me<T = unknown>(): Promise<T> {
    return this.request("/api/auth/me");
  }

  async refresh<T = { token: string }>(token = this.token): Promise<T> {
    if (!token) {
      throw new Error("No session token available to refresh.");
    }
    const previous = this.token;
    this.token = token;
    try {
      const session = await this.request<T>("/api/auth/refresh", { method: "POST" });
      if (typeof session === "object" && session && "token" in session && typeof session.token === "string") {
        this.token = session.token;
      }
      return session;
    } catch (error) {
      this.token = previous;
      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.request("/api/auth/logout", { method: "POST" });
    this.token = undefined;
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.request("/api/auth/password/change", { method: "POST", body: { currentPassword, newPassword } });
  }

  users(): Promise<AuthUser[]> {
    return this.request("/api/auth/users");
  }

  createUser(input: { id?: string; email: string; name: string; password: string; roles: string[]; permissions: string[]; disabledAt?: string; lockedUntil?: string }): Promise<AuthUser> {
    return this.request("/api/auth/users", { method: "POST", body: input });
  }

  updateUser(id: string, input: { email: string; name: string; password?: string; roles: string[]; permissions: string[]; disabledAt?: string; lockedUntil?: string }): Promise<AuthUser> {
    return this.request(`/api/auth/users/${id}`, { method: "PATCH", body: input });
  }

  deleteUser(id: string): Promise<void> {
    return this.request(`/api/auth/users/${id}`, { method: "DELETE" });
  }

  resetUserPassword(id: string, newPassword: string): Promise<void> {
    return this.request(`/api/auth/users/${id}/password`, { method: "POST", body: { newPassword } });
  }

  authAudit(): Promise<AuthAuditEvent[]> {
    return this.request("/api/auth/audit");
  }

  roles(): Promise<AuthRole[]> {
    return this.request("/api/auth/roles");
  }

  upsertRole(input: { id: string; name: string; permissions: string[] }): Promise<AuthRole> {
    return this.request("/api/auth/roles", { method: "POST", body: input });
  }

  updateRole(id: string, input: { name: string; permissions: string[] }): Promise<AuthRole> {
    return this.request(`/api/auth/roles/${id}`, { method: "PATCH", body: input });
  }

  deleteRole(id: string): Promise<void> {
    return this.request(`/api/auth/roles/${id}`, { method: "DELETE" });
  }

  apiTokens(): Promise<ApiToken[]> {
    return this.request("/api/auth/tokens");
  }

  createApiToken(input: { id?: string; name: string; userId?: string; roles: string[]; permissions: string[]; expiresAt?: string }): Promise<CreatedApiToken> {
    return this.request("/api/auth/tokens", { method: "POST", body: input });
  }

  revokeApiToken(id: string): Promise<ApiToken> {
    return this.request(`/api/auth/tokens/${id}`, { method: "DELETE" });
  }

  list<TData extends DocumentData = DocumentData>(doctype: string, options: ListDocumentsOptions = {}): Promise<DocumentRecord<TData>[]> {
    return this.request(`/api/doctypes/${doctype}${listQuery(options)}`, { signal: options.signal });
  }

  async listPage<TData extends DocumentData = DocumentData>(doctype: string, options: ListDocumentsOptions = {}): Promise<ListDocumentsPage<TData>> {
    const response = await this.execute(
      () => ofetch.raw<DocumentRecord<TData>[]>(this.baseUrl + `/api/doctypes/${doctype}${listQuery(options)}`, {
        headers: this.headers(), credentials: this.credentials, retry: 0, signal: options.signal
      }),
      "GET", {}, options.signal
    );
    return {
      items: response._data ?? [],
      nextCursor: response.headers.get("x-next-cursor") ?? undefined
    };
  }

  get<TData extends DocumentData = DocumentData>(doctype: string, id: string, options: FramekitRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { signal: options.signal });
  }

  create<TData extends DocumentData = DocumentData>(doctype: string, data: TData, options: Omit<MutationRequestOptions, "expectedRevision"> = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}`, { method: "POST", body: data, headers: mutationHeaders(options), signal: options.signal });
  }

  update<TData extends DocumentData = DocumentData>(doctype: string, id: string, data: Partial<TData>, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { method: "PATCH", body: data, headers: mutationHeaders(options), signal: options.signal });
  }

  delete(doctype: string, id: string, options: MutationRequestOptions = {}): Promise<void> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { method: "DELETE", headers: mutationHeaders(options), signal: options.signal });
  }

  transition<TData extends DocumentData = DocumentData>(doctype: string, id: string, action: string, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}/transition`, { method: "POST", body: { action }, headers: mutationHeaders(options), signal: options.signal });
  }

  submit<TData extends DocumentData = DocumentData>(doctype: string, id: string, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}/submit`, { method: "POST", headers: mutationHeaders(options), signal: options.signal });
  }

  cancel<TData extends DocumentData = DocumentData>(doctype: string, id: string, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}/cancel`, { method: "POST", headers: mutationHeaders(options), signal: options.signal });
  }

  transferOwner(doctype: string, id: string, ownerId: string, options: MutationRequestOptions = {}): Promise<OwnerTransferReceipt> {
    return this.request(`/api/doctypes/${doctype}/${id}/owner`, { method: "POST", body: { ownerId }, headers: mutationHeaders(options), signal: options.signal });
  }

  executeDocumentCommand(command: string, operations: DocumentCommandOperation[], options: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<DocumentCommandResult> {
    return this.request(`/api/commands/${encodeURIComponent(command)}`, {
      method: "POST",
      body: { operations },
      headers: options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : undefined,
      signal: options.signal
    });
  }

  uploadAttachment(doctype: string, id: string, field: string, input: { name: string; contentType: string; bytes: Uint8Array }, options: MutationRequestOptions = {}): Promise<AttachmentMetadata> {
    return this.request(`/api/doctypes/${pathSegment(doctype)}/${pathSegment(id)}/attachments/${pathSegment(field)}`, {
      method: "POST", body: { name: input.name, contentType: input.contentType, data: encodeBase64(input.bytes) }, headers: mutationHeaders(options), signal: options.signal
    });
  }

  async downloadAttachment(doctype: string, id: string, field: string, attachmentId: string, options: { signal?: AbortSignal } = {}): Promise<AttachmentDownload> {
    const response = await this.request<{ metadata: AttachmentMetadata; data: string }>(`/api/doctypes/${pathSegment(doctype)}/${pathSegment(id)}/attachments/${pathSegment(field)}/${pathSegment(attachmentId)}`, { signal: options.signal });
    return { metadata: response.metadata, bytes: decodeBase64(response.data) };
  }

  deleteAttachment(doctype: string, id: string, field: string, attachmentId: string, options: MutationRequestOptions = {}): Promise<void> {
    return this.request(`/api/doctypes/${pathSegment(doctype)}/${pathSegment(id)}/attachments/${pathSegment(field)}/${pathSegment(attachmentId)}`, { method: "DELETE", headers: mutationHeaders(options), signal: options.signal });
  }

  cleanupOrphanAttachments(options: { signal?: AbortSignal } = {}): Promise<{ deleted: string[] }> {
    return this.request("/api/attachments/cleanup", { method: "POST", signal: options.signal });
  }

  private request<T>(path: string, options: { method?: string; body?: unknown; skipAuth?: boolean; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
    const method = options.method ?? "GET";
    const headers = { ...this.headers(options.skipAuth), ...options.headers };
    return this.execute(() => ofetch<T>(this.baseUrl + path, {
      method, body: options.body as Record<string, unknown> | undefined, headers,
      credentials: this.credentials, retry: 0, signal: options.signal
    }), method, headers, options.signal);
  }

  private async execute<T>(request: () => Promise<T>, method: string, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const retrySafe = isRetrySafe(method, headers);
    const maxAttempts = retrySafe ? (this.retry?.maxAttempts ?? 1) : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) throw cancelledError(signal.reason);
      try {
        return await request();
      } catch (cause) {
        const error = toFramekitSdkError(cause, signal);
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        const exponential = (this.retry?.baseDelayMs ?? 100) * 2 ** (attempt - 1);
        await abortableDelay(Math.min(error.retryAfterMs ?? exponential, this.retry?.maxDelayMs ?? 5_000), signal);
      }
    }
    throw new FramekitTransportError("Request attempts exhausted.", "REQUEST_ATTEMPTS_EXHAUSTED", undefined, undefined, undefined, undefined);
  }

  private headers(skipAuth = false): Record<string, string> {
    const headers: Record<string, string> = {
      "x-tenant-id": this.tenant.tenantId ?? "default",
      "x-user-id": this.tenant.userId ?? "sdk",
      "x-roles": (this.tenant.roles ?? ["administrator"]).join(","),
      "x-permissions": (this.tenant.permissions ?? ["*"]).join(",")
    };
    if (this.token && !skipAuth && this.authMode === "bearer") {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}

export function createClient(options: FramekitClientOptions): FramekitClient {
  return new FramekitClient(options);
}

export function upgradeFramekitClientConfig(input: FramekitClientOptions): FramekitConfigUpgradeResult {
  const version = input.version;
  if (version !== undefined && version !== 1 && version !== 2) {
    throw new Error(`Unsupported Framekit SDK config version: ${String(version)}. Upgrade with a client that supports that version first.`);
  }
  const diagnostics: FramekitConfigUpgradeDiagnostic[] = [];
  if (version === undefined) diagnostics.push({ code: "ASSUMED_V1", message: "Unversioned SDK config was interpreted as version 1; persist version: 2 after reviewing retry policy." });
  if (version === 1) diagnostics.push({ code: "UPGRADED_V1", message: "SDK config version 1 upgraded to version 2 with retries disabled by default." });
  const { version: _version, ...values } = input;
  return { config: { ...values, version: 2 }, diagnostics };
}


function listQuery(options: ListDocumentsOptions): string {
  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  if (options.fields?.length) query.set("fields", options.fields.join(","));
  if (options.filters && Object.keys(options.filters).length > 0) query.set("filters", JSON.stringify(options.filters));
  if (options.sort) query.set("sort", options.sort.direction ? `${options.sort.field}:${options.sort.direction}` : options.sort.field);
  const value = query.toString();
  return value ? `?${value}` : "";
}

function mutationHeaders(options: MutationRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.expectedRevision !== undefined) headers["if-match"] = String(options.expectedRevision);
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return headers;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function pathSegment(value: string): string { if (!value) throw new Error("URL path segments must not be empty."); return encodeURIComponent(value); }
function decodeBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
