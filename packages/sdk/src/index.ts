import { ofetch } from "ofetch";
import { listDocTypes, type AppDefinition, type AttachmentMetadata, type DocumentCommandOperation, type DocumentData, type DocumentRecord, type FieldDefinition, type OwnerTransferReceipt, type TenantContext } from "@framekit/core";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  disabledAt?: string;
  lockedUntil?: string;
};

export type AuthRole = {
  tenantId: string;
  id: string;
  name: string;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ApiToken = {
  tenantId: string;
  id: string;
  name: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type CreatedApiToken = ApiToken & {
  token: string;
};

export type AuthAuditEvent = {
  id: string;
  tenantId: string;
  actorUserId?: string;
  targetUserId?: string;
  action: string;
  success: boolean;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type IssuedLifecycleToken = { token: string; expiresAt: string };

type FramekitClientBaseConfig = {
  baseUrl: string;
  tenant?: Partial<TenantContext>;
  token?: string;
  authMode?: "bearer" | "cookie";
  credentials?: RequestCredentials;
};

export type FramekitRetryPolicy = {
  /** Total attempts, including the first request. Must be between 1 and 5. */
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type FramekitClientConfigV1 = FramekitClientBaseConfig & { version: 1 };
export type FramekitClientConfigV2 = FramekitClientBaseConfig & { version: 2; retry?: FramekitRetryPolicy };
export type FramekitClientOptions = FramekitClientConfigV1 | FramekitClientConfigV2 | (FramekitClientBaseConfig & { version?: undefined; retry?: FramekitRetryPolicy });
export type FramekitConfigUpgradeDiagnostic = { code: "ASSUMED_V1" | "UPGRADED_V1"; message: string };
export type FramekitConfigUpgradeResult = { config: FramekitClientConfigV2; diagnostics: FramekitConfigUpgradeDiagnostic[] };
export const FRAMEKIT_SDK_CONFIG_VERSION = 2 as const;

export class FramekitSdkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | undefined,
    readonly details: unknown,
    readonly requestId: string | undefined,
    readonly retryAfterMs: number | undefined,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = new.target.name;
  }
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

export type FramekitRequestOptions = { signal?: AbortSignal };

export type ListDocumentsOptions = {
  search?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  fields?: string[];
  filters?: Record<string, unknown>;
  sort?: {
    field: string;
    direction?: "asc" | "desc";
  };
  signal?: AbortSignal;
};

export type ListDocumentsPage<TData extends DocumentData = DocumentData> = {
  items: DocumentRecord<TData>[];
  nextCursor?: string;
};

export type MutationRequestOptions = {
  expectedRevision?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type { DocumentCommandOperation } from "@framekit/core";

export type DocumentCommandResult = {
  command: string;
  mode: "atomic" | "saga";
  replayed: boolean;
  documents: Array<DocumentRecord | undefined>;
};

export type AttachmentDownload = { metadata: AttachmentMetadata; bytes: Uint8Array };

export type HealthResponse = {
  ok: true;
  app: string;
  version?: string;
};

export type DependencyHealthResponse = {
  ok: boolean;
  dependencies: Record<string, { ok: boolean; details?: unknown }>;
};

export type MigrationChange = {
  kind: "add_doctype" | "remove_doctype" | "add_field" | "remove_field" | "change_field_type" | "change_collection_schema" | "add_index" | "remove_index" | "add_unique_constraint" | "remove_unique_constraint" | "change_row_policy";
  doctype: string;
  field: string;
  destructive: boolean;
  from?: unknown;
  to?: unknown;
  rollback?: MigrationRollback;
};

export type MigrationRollback = Omit<MigrationChange, "rollback">;

export type MigrationPlan = {
  id: string;
  tenantId: string;
  appName: string;
  fromSchemaChecksum: string;
  toSchemaChecksum: string;
  fromUniqueConstraints: Array<{ doctype: string; field: string }>;
  toUniqueConstraints: Array<{ doctype: string; field: string }>;
  createdAt: string;
  changes: MigrationChange[];
  checksum: string;
};

export type MigrationRecord = MigrationPlan & {
  appliedAt: string;
};

export const FRAMEKIT_HTTP_ENDPOINTS = [
  ["health", "GET", "/health/live"],
  ["dependencyHealth", "GET", "/health/ready"],
  ["meta", "GET", "/api/meta"],
  ["diagnostics", "GET", "/api/diagnostics"],
  ["migrations", "GET", "/api/migrations"],
  ["realtimeEvents", "GET", "/api/realtime/events"],
  ["streamRealtimeEvents", "GET", "/api/realtime/stream"],
  ["planMigration", "POST", "/api/migrations/plan"],
  ["applyMigration", "POST", "/api/migrations/apply"],
  ["openapi", "GET", "/api/openapi.json"],
  ["audit", "GET", "/api/audit"],
  ["outbox", "GET", "/api/outbox"],
  ["markOutboxDispatched", "POST", "/api/outbox/:id/dispatch"],
  ["markOutboxFailed", "POST", "/api/outbox/:id/fail"],
  ["customFields", "GET", "/api/custom-fields"],
  ["addCustomField", "POST", "/api/custom-fields"],
  ["views", "GET", "/api/views"],
  ["upsertView", "POST", "/api/views"],
  ["login", "POST", "/api/auth/login"],
  ["loginWithProvider", "POST", "/api/auth/providers/:providerId/login"],
  ["providerAuthorizationUrl", "GET", "/api/auth/providers/:providerId/authorize"],
  ["createInvitation", "POST", "/api/auth/invitations"],
  ["linkProviderIdentity", "POST", "/api/auth/identity-links"],
  ["acceptInvitation", "POST", "/api/auth/invitations/accept"],
  ["requestPasswordReset", "POST", "/api/auth/password/reset/request"],
  ["completePasswordReset", "POST", "/api/auth/password/reset/complete"],
  ["createRecoveryToken", "POST", "/api/auth/users/:userId/recovery"],
  ["me", "GET", "/api/auth/me"],
  ["refresh", "POST", "/api/auth/refresh"],
  ["logout", "POST", "/api/auth/logout"],
  ["changePassword", "POST", "/api/auth/password/change"],
  ["users", "GET", "/api/auth/users"],
  ["createUser", "POST", "/api/auth/users"],
  ["updateUser", "PATCH", "/api/auth/users/:id"],
  ["deleteUser", "DELETE", "/api/auth/users/:id"],
  ["resetUserPassword", "POST", "/api/auth/users/:id/password"],
  ["authAudit", "GET", "/api/auth/audit"],
  ["roles", "GET", "/api/auth/roles"],
  ["upsertRole", "POST", "/api/auth/roles"],
  ["updateRole", "PATCH", "/api/auth/roles/:id"],
  ["deleteRole", "DELETE", "/api/auth/roles/:id"],
  ["apiTokens", "GET", "/api/auth/tokens"],
  ["createApiToken", "POST", "/api/auth/tokens"],
  ["revokeApiToken", "DELETE", "/api/auth/tokens/:id"],
  ["list", "GET", "/api/doctypes/:doctype"],
  ["listPage", "GET", "/api/doctypes/:doctype"],
  ["get", "GET", "/api/doctypes/:doctype/:id"],
  ["create", "POST", "/api/doctypes/:doctype"],
  ["update", "PATCH", "/api/doctypes/:doctype/:id"],
  ["delete", "DELETE", "/api/doctypes/:doctype/:id"],
  ["transition", "POST", "/api/doctypes/:doctype/:id/transition"],
  ["submit", "POST", "/api/doctypes/:doctype/:id/submit"],
  ["cancel", "POST", "/api/doctypes/:doctype/:id/cancel"],
  ["transferOwner", "POST", "/api/doctypes/:doctype/:id/owner"],
  ["executeDocumentCommand", "POST", "/api/commands/:command"],
  ["uploadAttachment", "POST", "/api/doctypes/:doctype/:id/attachments/:field"],
  ["downloadAttachment", "GET", "/api/doctypes/:doctype/:id/attachments/:field/:attachmentId"],
  ["deleteAttachment", "DELETE", "/api/doctypes/:doctype/:id/attachments/:field/:attachmentId"],
  ["cleanupOrphanAttachments", "POST", "/api/attachments/cleanup"]
] as const;

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

  meta<T = unknown>(): Promise<T> {
    return this.request("/api/meta");
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

export function generateSdkTypes(app: AppDefinition): string {
  const lines: string[] = [
    "import type { AttachmentMetadata, DocumentRecord } from \"@framekit/core\";",
    "export { FramekitSdkError, FramekitValidationError, FramekitAuthenticationError, FramekitAuthorizationError, FramekitNotFoundError, FramekitConflictError, FramekitRateLimitError, FramekitServerError, FramekitResponseError, FramekitTransportError, FramekitProtocolError, FramekitCancelledError } from \"@framekit/sdk\";",
    "export type { FramekitClientConfigV1, FramekitClientConfigV2, FramekitRetryPolicy } from \"@framekit/sdk\";",
    ""
  ];
  for (const doctype of listDocTypes(app)) {
    const name = pascal(doctype.name);
    lines.push(`export type ${name}Input = {`);
    for (const field of doctype.fields.filter((candidate) => !candidate.computed && candidate.type !== "attachments")) {
      lines.push(`  ${field.name}${field.required ? "" : "?"}: ${tsType(field, "input")};`);
    }
    lines.push("};", "");
    lines.push(`export type ${name}Patch = Partial<${name}Input>;`);
    lines.push(`export type ${name}Data = {`);
    for (const field of doctype.fields) {
      lines.push(`  ${field.name}${field.required || field.computed ? "" : "?"}: ${tsType(field, "output")};`);
    }
    lines.push("};", "");
    lines.push(`export type ${name}Record = DocumentRecord<${name}Data>;`);
    if (doctype.workflow) {
      const actions = [...new Set(doctype.workflow.transitions.map((transition) => transition.action))];
      lines.push(`export type ${name}WorkflowAction = ${actions.map((action) => JSON.stringify(action)).join(" | ") || "never"};`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function listQuery(options: ListDocumentsOptions): string {
  const params = new URLSearchParams();
  if (options.search) {
    params.set("search", options.search);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }
  if (options.fields && options.fields.length > 0) {
    params.set("fields", options.fields.join(","));
  }
  if (options.filters && Object.keys(options.filters).length > 0) {
    params.set("filters", JSON.stringify(options.filters));
  }
  if (options.sort) {
    params.set("sort", options.sort.direction ? `${options.sort.field}:${options.sort.direction}` : options.sort.field);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function mutationHeaders(options: MutationRequestOptions): Record<string, string> {
  return {
    ...(options.expectedRevision === undefined ? {} : { "if-match": String(options.expectedRevision) }),
    ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
  };
}

function normalizeRetryPolicy(policy: FramekitRetryPolicy | undefined): Required<FramekitRetryPolicy> | undefined {
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

function isRetrySafe(method: string, headers: Record<string, string>): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) || Boolean(headers["idempotency-key"]);
}

function isRetryable(error: FramekitSdkError): boolean {
  return error instanceof FramekitTransportError || error instanceof FramekitRateLimitError || [408, 425, 500, 502, 503, 504].includes(error.status ?? 0);
}

function toFramekitSdkError(cause: unknown, signal?: AbortSignal): FramekitSdkError {
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

async function responseToSdkError(response: Response, signal?: AbortSignal): Promise<FramekitSdkError> {
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

function cancelledError(reason: unknown): FramekitCancelledError {
  return new FramekitCancelledError("Framekit request was cancelled.", "REQUEST_CANCELLED", undefined, reason, undefined, undefined, { cause: reason });
}

function streamReadError(cause: unknown, response: Response, signal?: AbortSignal): FramekitSdkError {
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

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
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

function tsType(field: FieldDefinition, direction: "input" | "output" = "output"): string {
  const domain = field.validators.find((validator) => validator.kind === "domain");
  if (domain?.kind === "domain") return domain.values.map((value) => JSON.stringify(value)).join(" | ");
  switch (field.type) {
    case "number":
      return "number";
    case "decimal":
    case "currency":
      return "string";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "select":
      return field.options?.length ? field.options.map((option) => JSON.stringify(option)).join(" | ") : "string";
    case "children":
      return `Array<{ id${direction === "input" ? "?" : ""}: string; position${direction === "input" ? "?" : ""}: number; data: { ${(field.fields ?? []).map((child) => `${child.name}${child.required ? "" : "?"}: ${tsType(child as FieldDefinition, direction)}`).join("; ")} } }>`;
    case "attachments":
      return "AttachmentMetadata[]";
    default:
      return "string";
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function pathSegment(value: string): string {
  if (!value) throw new Error("URL path segments must not be empty.");
  return encodeURIComponent(value);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function pascal(value: string): string {
  return value.split(/[-_]/g).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function parseSseChunk(chunk: string, response?: Response): { id?: string; type: string; data: unknown } | undefined {
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
