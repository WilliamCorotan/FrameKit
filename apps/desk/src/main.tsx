import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Boxes, Check, Database, FileClock, FilePlus, KeyRound, LogOut, Radio, RefreshCw, Save, Search, Settings, Shield, Users } from "lucide-react";
import "./styles.css";

type FieldDefinition = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  inList?: boolean;
  readOnly?: boolean;
};

type DocTypeDefinition = {
  name: string;
  label: string;
  description?: string;
  fields: FieldDefinition[];
  views?: Array<{ id: string; doctype: string; type: "list" | "form"; fields: string[] }>;
  workflow?: {
    field: string;
    initialState: string;
    states: string[];
    transitions: Array<{ action: string; from: string[]; to: string }>;
  };
};

type ModuleDefinition = {
  id: string;
  name: string;
  description?: string;
  doctypes: DocTypeDefinition[];
};

type Metadata = {
  name: string;
  version: string;
  modules: ModuleDefinition[];
};

type DocumentRecord = {
  id: string;
  doctype: string;
  state?: string;
  data: Record<string, unknown>;
  updatedAt: string;
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
};

type AuthRole = {
  id: string;
  name: string;
  permissions: string[];
};

type ApiToken = {
  id: string;
  name: string;
  roles: string[];
  permissions: string[];
  createdAt: string;
  revokedAt?: string;
};

type CreatedApiToken = ApiToken & {
  token: string;
};

type AuditEvent = {
  id: string;
  userId: string;
  action: string;
  doctype: string;
  documentId: string;
  createdAt: string;
};

type OutboxEvent = {
  id: string;
  type: string;
  topic: string;
  status: "pending" | "dispatched" | "failed";
  attempts: number;
  createdAt: string;
  error?: string;
};

type Diagnostics = {
  app: { name: string; version: string };
  repository: { kind: string; durable: boolean; features: string[] };
  audit: { kind: string; durable: boolean; features: string[] };
  outbox: { kind: string; durable: boolean; features: string[] };
  customization: { kind: string; durable: boolean; features: string[] };
  warnings: string[];
};

type CustomField = {
  id: string;
  doctype: string;
  field: FieldDefinition;
};

type DeskSection = "documents" | "users" | "roles" | "tokens" | "audit" | "outbox" | "diagnostics" | "customization";

const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "http://localhost:3000";

function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem("framekit.token") ?? "");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin12345");
  const [metadata, setMetadata] = useState<Metadata | undefined>();
  const [activeDocType, setActiveDocType] = useState("customer");
  const [section, setSection] = useState<DeskSection>("documents");
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [selected, setSelected] = useState<DocumentRecord | undefined>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading metadata");

  const doctypes = useMemo(() => metadata?.modules.flatMap((module) => module.doctypes) ?? [], [metadata]);
  const active = doctypes.find((doctype) => doctype.name === activeDocType) ?? doctypes[0];

  useEffect(() => {
    if (!token) {
      return;
    }
    fetchJson<Metadata>("/api/meta", { token })
      .then((next) => {
        setMetadata(next);
        setActiveDocType(next.modules.flatMap((module) => module.doctypes)[0]?.name ?? "customer");
        setStatus("Ready");
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Failed to load metadata"));
  }, [token]);

  useEffect(() => {
    if (!active || section !== "documents") {
      return;
    }
    void refresh(active.name, query);
  }, [active?.name, query, section]);

  async function login() {
    setStatus("Signing in");
    const session = await fetchJson<{ token: string }>("/api/auth/login", { method: "POST", body: { email, password } });
    window.localStorage.setItem("framekit.token", session.token);
    setToken(session.token);
    setStatus("Ready");
  }

  function logout() {
    window.localStorage.removeItem("framekit.token");
    setToken("");
    setMetadata(undefined);
    setRecords([]);
    setSelected(undefined);
  }

  async function refresh(doctype = activeDocType, search = query) {
    setStatus("Syncing");
    const suffix = search ? `?search=${encodeURIComponent(search)}` : "";
    const list = await fetchJson<DocumentRecord[]>(`/api/doctypes/${doctype}${suffix}`, { token });
    setRecords(list);
    setSelected(list[0]);
    setDraft(list[0]?.data ?? {});
    setStatus("Ready");
  }

  async function save() {
    if (!active) {
      return;
    }
    setStatus("Saving");
    const record = selected
      ? await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}`, { method: "PATCH", body: draft, token })
      : await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}`, { method: "POST", body: draft, token });
    setSelected(record);
    setDraft(record.data);
    await refresh(active.name, query);
    setStatus("Saved");
  }

  async function transition(action: string) {
    if (!active || !selected) {
      return;
    }
    setStatus("Transitioning");
    const record = await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}/transition`, { method: "POST", body: { action }, token });
    setSelected(record);
    setDraft(record.data);
    await refresh(active.name, query);
    setStatus("Transitioned");
  }

  function startNew() {
    setSelected(undefined);
    setDraft({});
  }

  const listViewFields = active?.views?.find((view) => view.type === "list")?.fields;
  const formViewFields = active?.views?.find((view) => view.type === "form")?.fields;
  const listFields = active ? orderedFields(active, listViewFields, active.fields.filter((field) => field.inList).map((field) => field.name)).slice(0, 4) : [];
  const formFields = active ? orderedFields(active, formViewFields, active.fields.map((field) => field.name)) : [];
  const availableTransitions =
    active?.workflow && selected
      ? active.workflow.transitions.filter((transition) => transition.from.includes(selected.state ?? active.workflow!.initialState))
      : [];

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="mark"><Boxes size={24} /> Framekit</div>
          <p className="eyebrow">Desk sign in</p>
          <h1>Metadata operations console</h1>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary wide" onClick={() => void login()}><KeyRound size={16} /> Sign in</button>
          <p className="status">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="desk">
      <aside className="rail">
        <div className="mark"><Boxes size={22} /> Framekit</div>
        <div className="version">{metadata?.name ?? "Metadata Desk"} · {metadata?.version ?? "0.1.0"}</div>
        <nav>
          {doctypes.map((doctype) => (
            <button key={doctype.name} className={section === "documents" && doctype.name === active?.name ? "active" : ""} onClick={() => { setSection("documents"); setActiveDocType(doctype.name); }}>
              <Database size={17} />
              <span>{doctype.label}</span>
            </button>
          ))}
          <button className={section === "users" ? "active" : ""} onClick={() => setSection("users")}><Users size={17} /><span>Users</span></button>
          <button className={section === "roles" ? "active" : ""} onClick={() => setSection("roles")}><Shield size={17} /><span>Roles</span></button>
          <button className={section === "tokens" ? "active" : ""} onClick={() => setSection("tokens")}><KeyRound size={17} /><span>API Tokens</span></button>
          <button className={section === "customization" ? "active" : ""} onClick={() => setSection("customization")}><Settings size={17} /><span>Customization</span></button>
          <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><FileClock size={17} /><span>Audit</span></button>
          <button className={section === "outbox" ? "active" : ""} onClick={() => setSection("outbox")}><Radio size={17} /><span>Outbox</span></button>
          <button className={section === "diagnostics" ? "active" : ""} onClick={() => setSection("diagnostics")}><Activity size={17} /><span>Diagnostics</span></button>
          <button onClick={logout}><LogOut size={17} /><span>Sign out</span></button>
        </nav>
      </aside>

      <section className="workbench">
        {section === "users" || section === "roles" || section === "tokens" ? <AdminPanel section={section} token={token} status={status} setStatus={setStatus} /> : null}
        {section === "audit" || section === "outbox" || section === "diagnostics" || section === "customization" ? <OperationsPanel section={section} token={token} doctypes={doctypes} status={status} setStatus={setStatus} /> : null}
        {section === "documents" ? (
        <>
        <header className="topbar">
          <div>
            <p className="eyebrow">DocType</p>
            <h1>{active?.label ?? "Loading"}</h1>
          </div>
          <div className="toolbar">
            <label className="search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter records" />
            </label>
            <button onClick={() => void refresh()} title="Refresh"><RefreshCw size={16} /></button>
            <button onClick={startNew} title="New document"><FilePlus size={16} /></button>
          </div>
        </header>

        <div className="grid">
          <section className="list">
            <div className="list-head">
              <span>{records.length} records</span>
              <span>{status}</span>
            </div>
            {records.map((record) => (
              <button key={record.id} className={selected?.id === record.id ? "row selected" : "row"} onClick={() => { setSelected(record); setDraft(record.data); }}>
                <strong>{record.id}</strong>
                <span>{listFields.map((field) => String(record.data[field.name] ?? "")).filter(Boolean).join(" · ") || record.doctype}</span>
              </button>
            ))}
          </section>

          <section className="editor">
            <div className="editor-head">
              <div>
                <p className="eyebrow">{selected ? selected.id : "New document"}</p>
                <h2>{active?.description ?? "Metadata-generated form"}</h2>
              </div>
              <button className="primary" onClick={() => void save()}><Save size={16} /> Save</button>
            </div>

            <div className="fields">
              {formFields.map((field) => (
                <label key={field.name} className="field">
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <FieldInput field={field} value={draft[field.name]} onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))} />
                </label>
              ))}
            </div>

            {availableTransitions.length > 0 ? (
              <div className="transitions">
                <span><Activity size={16} /> Workflow</span>
                {availableTransitions.map((item) => (
                  <button key={item.action} onClick={() => void transition(item.action)}><Check size={15} /> {item.action}</button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
        </>
        ) : null}
      </section>
    </main>
  );
}

function AdminPanel({ section, token, status, setStatus }: { section: "users" | "roles" | "tokens"; token: string; status: string; setStatus: (status: string) => void }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createdToken, setCreatedToken] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    void refresh();
  }, [section]);

  async function refresh() {
    setStatus("Syncing");
    if (section === "users") {
      setUsers(await fetchJson<AuthUser[]>("/api/auth/users", { token }));
    }
    if (section === "roles") {
      setRoles(await fetchJson<AuthRole[]>("/api/auth/roles", { token }));
    }
    if (section === "tokens") {
      setTokens(await fetchJson<ApiToken[]>("/api/auth/tokens", { token }));
    }
    setStatus("Ready");
  }

  async function submit() {
    setStatus("Saving");
    if (section === "users") {
      await fetchJson<AuthUser>("/api/auth/users", {
        method: "POST",
        token,
        body: {
          id: form.id,
          email: form.email,
          name: form.name,
          password: form.password,
          roles: csv(form.roles),
          permissions: csv(form.permissions)
        }
      });
    }
    if (section === "roles") {
      await fetchJson<AuthRole>("/api/auth/roles", {
        method: "POST",
        token,
        body: { id: form.id, name: form.name, permissions: csv(form.permissions) }
      });
    }
    if (section === "tokens") {
      const created = await fetchJson<CreatedApiToken>("/api/auth/tokens", {
        method: "POST",
        token,
        body: { id: form.id, name: form.name, roles: csv(form.roles), permissions: csv(form.permissions) }
      });
      setCreatedToken(created.token);
    }
    setForm({});
    await refresh();
  }

  async function remove(id: string) {
    setStatus("Deleting");
    const path = section === "users" ? `/api/auth/users/${id}` : section === "roles" ? `/api/auth/roles/${id}` : `/api/auth/tokens/${id}`;
    await fetchJson(path, { method: "DELETE", token });
    await refresh();
  }

  const items = section === "users" ? users : section === "roles" ? roles : tokens;
  const title = section === "users" ? "Users" : section === "roles" ? "Roles" : "API Tokens";

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>{title}</h1>
        </div>
        <button className="primary" onClick={() => void refresh()}><RefreshCw size={16} /> Refresh</button>
      </header>
      <div className="admin-grid">
        <section className="editor">
          <div className="editor-head">
            <div>
              <p className="eyebrow">Create</p>
              <h2>{title}</h2>
            </div>
            <button className="primary" onClick={() => void submit()}><Save size={16} /> Save</button>
          </div>
          <div className="fields">
            <label className="field"><span>ID</span><input value={form.id ?? ""} onChange={(event) => setForm((next) => ({ ...next, id: event.target.value }))} /></label>
            <label className="field"><span>Name</span><input value={form.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, name: event.target.value }))} /></label>
            {section === "users" ? <label className="field"><span>Email</span><input value={form.email ?? ""} onChange={(event) => setForm((next) => ({ ...next, email: event.target.value }))} /></label> : null}
            {section === "users" ? <label className="field"><span>Password</span><input type="password" value={form.password ?? ""} onChange={(event) => setForm((next) => ({ ...next, password: event.target.value }))} /></label> : null}
            {section !== "roles" ? <label className="field"><span>Roles</span><input value={form.roles ?? ""} onChange={(event) => setForm((next) => ({ ...next, roles: event.target.value }))} placeholder="administrator,sales" /></label> : null}
            <label className="field"><span>Permissions</span><input value={form.permissions ?? ""} onChange={(event) => setForm((next) => ({ ...next, permissions: event.target.value }))} placeholder="*,crm.customer.read" /></label>
          </div>
          {createdToken ? <p className="token-copy">{createdToken}</p> : null}
        </section>
        <section className="list">
          <div className="list-head"><span>{items.length} records</span><span>{status}</span></div>
          {items.map((item) => (
            <button key={item.id} className="row" onClick={() => void remove(item.id)}>
              <strong>{item.id}</strong>
              <span>{adminItemLabel(item)} · {item.permissions.join(", ") || "no permissions"}{"revokedAt" in item && item.revokedAt ? " · revoked" : ""}</span>
            </button>
          ))}
        </section>
      </div>
    </>
  );
}

function OperationsPanel({ section, token, doctypes, status, setStatus }: { section: "audit" | "outbox" | "diagnostics" | "customization"; token: string; doctypes: DocTypeDefinition[]; status: string; setStatus: (status: string) => void }) {
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [outbox, setOutbox] = useState<OutboxEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>();
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    void refresh();
  }, [section]);

  async function refresh() {
    setStatus("Syncing");
    if (section === "audit") {
      setAudit(await fetchJson<AuditEvent[]>("/api/audit?limit=50", { token }));
    }
    if (section === "outbox") {
      setOutbox(await fetchJson<OutboxEvent[]>("/api/outbox?limit=50", { token }));
    }
    if (section === "diagnostics") {
      setDiagnostics(await fetchJson<Diagnostics>("/api/diagnostics", { token }));
    }
    if (section === "customization") {
      setCustomFields(await fetchJson<CustomField[]>("/api/custom-fields", { token }));
    }
    setStatus("Ready");
  }

  async function addCustomField() {
    setStatus("Saving");
    await fetchJson<CustomField>("/api/custom-fields", {
      method: "POST",
      token,
      body: {
        doctype: form.doctype ?? doctypes[0]?.name,
        field: {
          name: form.name,
          label: form.label,
          type: form.type || "text",
          options: csv(form.options),
          inList: form.inList === "true",
          required: form.required === "true"
        }
      }
    });
    setForm({});
    await refresh();
  }

  async function markOutbox(id: string, action: "dispatch" | "fail") {
    setStatus("Updating");
    await fetchJson(`/api/outbox/${id}/${action}`, { method: "POST", token, body: action === "fail" ? { error: "Marked failed from Desk" } : undefined });
    await refresh();
  }

  const title = section === "audit" ? "Audit Trail" : section === "outbox" ? "Outbox" : section === "diagnostics" ? "Diagnostics" : "Customization";

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>{title}</h1>
        </div>
        <button className="primary" onClick={() => void refresh()}><RefreshCw size={16} /> Refresh</button>
      </header>

      {section === "customization" ? (
        <div className="admin-grid">
          <section className="editor">
            <div className="editor-head">
              <div>
                <p className="eyebrow">Custom field</p>
                <h2>Add tenant metadata</h2>
              </div>
              <button className="primary" onClick={() => void addCustomField()}><Save size={16} /> Save</button>
            </div>
            <div className="fields">
              <label className="field"><span>DocType</span><select value={form.doctype ?? doctypes[0]?.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, doctype: event.target.value }))}>{doctypes.map((doctype) => <option key={doctype.name} value={doctype.name}>{doctype.label}</option>)}</select></label>
              <label className="field"><span>Name</span><input value={form.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, name: event.target.value }))} /></label>
              <label className="field"><span>Label</span><input value={form.label ?? ""} onChange={(event) => setForm((next) => ({ ...next, label: event.target.value }))} /></label>
              <label className="field"><span>Type</span><select value={form.type ?? "text"} onChange={(event) => setForm((next) => ({ ...next, type: event.target.value }))}><option value="text">Text</option><option value="number">Number</option><option value="currency">Currency</option><option value="boolean">Boolean</option><option value="select">Select</option><option value="date">Date</option></select></label>
              <label className="field"><span>Options</span><input value={form.options ?? ""} onChange={(event) => setForm((next) => ({ ...next, options: event.target.value }))} placeholder="open,won,lost" /></label>
              <label className="field"><span>List Field</span><select value={form.inList ?? "false"} onChange={(event) => setForm((next) => ({ ...next, inList: event.target.value }))}><option value="false">No</option><option value="true">Yes</option></select></label>
            </div>
          </section>
          <RecordList items={customFields.map((field) => ({ id: field.id, label: `${field.doctype}.${field.field.name}`, detail: `${field.field.label} · ${field.field.type}` }))} status={status} />
        </div>
      ) : null}

      {section === "audit" ? <RecordList items={audit.map((event) => ({ id: event.id, label: `${event.action} ${event.doctype}`, detail: `${event.documentId} · ${event.userId} · ${event.createdAt}` }))} status={status} /> : null}

      {section === "outbox" ? (
        <section className="list operation-list">
          <div className="list-head"><span>{outbox.length} events</span><span>{status}</span></div>
          {outbox.map((event) => (
            <div key={event.id} className="row passive">
              <strong>{event.type}</strong>
              <span>{event.status} · {event.attempts} attempts · {event.error ?? event.createdAt}</span>
              <div className="row-actions">
                <button onClick={() => void markOutbox(event.id, "dispatch")}>Dispatch</button>
                <button onClick={() => void markOutbox(event.id, "fail")}>Fail</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {section === "diagnostics" && diagnostics ? (
        <div className="diagnostics-grid">
          {[diagnostics.repository, diagnostics.audit, diagnostics.outbox, diagnostics.customization].map((item) => (
            <section key={item.kind + item.features.join(",")} className="metric">
              <strong>{item.kind}</strong>
              <span>{item.durable ? "durable" : "ephemeral"}</span>
              <small>{item.features.join(", ") || "no features"}</small>
            </section>
          ))}
          <section className="list operation-list">
            <div className="list-head"><span>{diagnostics.warnings.length} warnings</span><span>{status}</span></div>
            {diagnostics.warnings.map((warning) => <div key={warning} className="row passive"><strong>{warning}</strong></div>)}
          </section>
        </div>
      ) : null}
    </>
  );
}

function RecordList({ items, status }: { items: Array<{ id: string; label: string; detail: string }>; status: string }) {
  return (
    <section className="list operation-list">
      <div className="list-head"><span>{items.length} records</span><span>{status}</span></div>
      {items.map((item) => (
        <div key={item.id} className="row passive">
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
        </div>
      ))}
    </section>
  );
}

function adminItemLabel(item: AuthUser | AuthRole | ApiToken): string {
  return "email" in item ? item.email : item.name;
}

function orderedFields(doctype: DocTypeDefinition, preferred: string[] | undefined, fallback: string[]): FieldDefinition[] {
  const fieldNames = preferred && preferred.length > 0 ? preferred : fallback;
  const fields = fieldNames
    .map((name) => doctype.fields.find((field) => field.name === name))
    .filter((field): field is FieldDefinition => Boolean(field));
  return fields.length > 0 ? fields : doctype.fields;
}

function FieldInput({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "select") {
    return (
      <select value={String(value ?? field.options?.[0] ?? "")} onChange={(event) => onChange(event.target.value)} disabled={field.readOnly}>
        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "boolean") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} disabled={field.readOnly} />;
  }
  if (field.type === "long_text") {
    return <textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} disabled={field.readOnly} />;
  }
  return <input type={field.type === "number" || field.type === "currency" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} disabled={field.readOnly} />;
}

async function fetchJson<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": "default"
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(apiUrl + path, {
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function csv(value: string | undefined): string[] {
  return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
}

createRoot(document.getElementById("root")!).render(<App />);
