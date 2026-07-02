import { ofetch } from "ofetch";
import type { DocumentData, DocumentRecord, TenantContext } from "@framekit/core";

export type FramekitClientOptions = {
  baseUrl: string;
  tenant?: Partial<TenantContext>;
  token?: string;
};

export class FramekitClient {
  private readonly baseUrl: string;
  private readonly tenant: Partial<TenantContext>;
  private token?: string;

  constructor(options: FramekitClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tenant = options.tenant ?? {};
    this.token = options.token;
  }

  meta<T = unknown>(): Promise<T> {
    return this.request("/api/meta");
  }

  diagnostics<T = unknown>(): Promise<T> {
    return this.request("/api/diagnostics");
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

  me<T = unknown>(): Promise<T> {
    return this.request("/api/auth/me");
  }

  list<TData extends DocumentData = DocumentData>(doctype: string): Promise<DocumentRecord<TData>[]> {
    return this.request(`/api/doctypes/${doctype}`);
  }

  get<TData extends DocumentData = DocumentData>(doctype: string, id: string): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`);
  }

  create<TData extends DocumentData = DocumentData>(doctype: string, data: TData): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}`, { method: "POST", body: data });
  }

  update<TData extends DocumentData = DocumentData>(doctype: string, id: string, data: Partial<TData>): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}`, { method: "PATCH", body: data });
  }

  transition<TData extends DocumentData = DocumentData>(doctype: string, id: string, action: string): Promise<DocumentRecord<TData>> {
    return this.request(`/api/doctypes/${doctype}/${id}/transition`, { method: "POST", body: { action } });
  }

  private request<T>(path: string, options: { method?: string; body?: unknown; skipAuth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {
      "x-tenant-id": this.tenant.tenantId ?? "default",
      "x-user-id": this.tenant.userId ?? "sdk",
      "x-roles": (this.tenant.roles ?? ["administrator"]).join(","),
      "x-permissions": (this.tenant.permissions ?? ["*"]).join(",")
    };
    if (this.token && !options.skipAuth) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return ofetch<T>(this.baseUrl + path, {
      method: options.method,
      body: options.body as Record<string, unknown> | undefined,
      headers
    });
  }
}

export function createClient(options: FramekitClientOptions): FramekitClient {
  return new FramekitClient(options);
}
