import { ofetch } from "ofetch";
import { listDocTypes, type AppDefinition, type DocumentData, type DocumentRecord, type FieldDefinition, type TenantContext } from "@framekit/core";

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

export type FramekitClientOptions = {
  baseUrl: string;
  tenant?: Partial<TenantContext>;
  token?: string;
  authMode?: "bearer" | "cookie";
  credentials?: RequestCredentials;
};

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
};

export type MutationRequestOptions = {
  expectedRevision?: number;
  idempotencyKey?: string;
};

export class FramekitClient {
  private readonly baseUrl: string;
  private readonly tenant: Partial<TenantContext>;
  private readonly authMode: "bearer" | "cookie";
  private readonly credentials?: RequestCredentials;
  private token?: string;

  constructor(options: FramekitClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tenant = options.tenant ?? {};
    this.authMode = options.authMode ?? "bearer";
    this.credentials = options.credentials ?? (this.authMode === "cookie" ? "include" : undefined);
    this.token = options.token;
  }

  meta<T = unknown>(): Promise<T> {
    return this.request("/api/meta");
  }

  diagnostics<T = unknown>(): Promise<T> {
    return this.request("/api/diagnostics");
  }

  migrations<T = unknown>(): Promise<T> {
    return this.request("/api/migrations");
  }

  realtimeEvents<T = unknown>(options: { limit?: number } = {}): Promise<T> {
    const query = options.limit === undefined ? "" : `?limit=${encodeURIComponent(String(options.limit))}`;
    return this.request(`/api/realtime/events${query}`);
  }

  async streamRealtimeEvents(
    onEvent: (event: { type: string; data: unknown }) => void,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const response = await fetch(this.baseUrl + "/api/realtime/stream", {
      headers: this.headers(),
      credentials: this.credentials,
      signal: options.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = parseSseChunk(chunk);
        if (event) {
          onEvent(event);
        }
      }
    }
  }

  planMigration<T = unknown>(app: unknown): Promise<T> {
    return this.request("/api/migrations/plan", { method: "POST", body: { app } });
  }

  applyMigration<T = unknown>(plan: unknown, options: { allowDestructive?: boolean } = {}): Promise<T> {
    return this.request("/api/migrations/apply", { method: "POST", body: { plan, allowDestructive: options.allowDestructive } });
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
    return this.request(`/api/doctypes/${doctype}${listQuery(options)}`);
  }

  get<TData extends DocumentData = DocumentData>(doctype: string, id: string): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`);
  }

  create<TData extends DocumentData = DocumentData>(doctype: string, data: TData, options: Omit<MutationRequestOptions, "expectedRevision"> = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}`, { method: "POST", body: data, headers: mutationHeaders(options) });
  }

  update<TData extends DocumentData = DocumentData>(doctype: string, id: string, data: Partial<TData>, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { method: "PATCH", body: data, headers: mutationHeaders(options) });
  }

  delete(doctype: string, id: string, options: MutationRequestOptions = {}): Promise<void> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { method: "DELETE", headers: mutationHeaders(options) });
  }

  transition<TData extends DocumentData = DocumentData>(doctype: string, id: string, action: string, options: MutationRequestOptions = {}): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}/transition`, { method: "POST", body: { action }, headers: mutationHeaders(options) });
  }

  private request<T>(path: string, options: { method?: string; body?: unknown; skipAuth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    return ofetch<T>(this.baseUrl + path, {
      method: options.method,
      body: options.body as Record<string, unknown> | undefined,
      headers: { ...this.headers(options.skipAuth), ...options.headers },
      credentials: this.credentials
    });
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

export function generateSdkTypes(app: AppDefinition): string {
  const lines: string[] = [
    "import type { DocumentRecord } from \"@framekit/core\";",
    ""
  ];
  for (const doctype of listDocTypes(app)) {
    const name = pascal(doctype.name);
    lines.push(`export type ${name}Input = {`);
    for (const field of doctype.fields) {
      lines.push(`  ${field.name}${field.required ? "" : "?"}: ${tsType(field)};`);
    }
    lines.push("};", "");
    lines.push(`export type ${name}Patch = Partial<${name}Input>;`);
    lines.push(`export type ${name}Record = DocumentRecord<${name}Input>;`);
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

function tsType(field: FieldDefinition): string {
  switch (field.type) {
    case "number":
    case "currency":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "select":
      return field.options?.length ? field.options.map((option) => JSON.stringify(option)).join(" | ") : "string";
    default:
      return "string";
  }
}

function pascal(value: string): string {
  return value.split(/[-_]/g).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function parseSseChunk(chunk: string): { type: string; data: unknown } | undefined {
  const type = chunk.split("\n").find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "message";
  const data = chunk.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
  if (!data) {
    return undefined;
  }
  return { type, data: JSON.parse(data) as unknown };
}
