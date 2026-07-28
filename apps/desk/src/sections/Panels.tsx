import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { ApiToken, AuditEvent, AuthRole, AuthUser, CreatedApiToken, CustomField, Diagnostics, DocTypeDefinition, OutboxEvent, PublicSetting } from "../domain/types";
import { csv, errorMessage, fetchJson } from "../transport/client";

export function AdminPanel({ section, token, status, setStatus }: { section: "users" | "roles" | "tokens"; token: string; status: string; setStatus: (status: string) => void }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createdToken, setCreatedToken] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    void refresh();
  }, [section]);

  async function refresh() {
    try {
      setStatus("Syncing…");
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
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function submit() {
    try {
      setStatus("Saving…");
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
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete ${id}? This cannot be undone.`)) {
      return;
    }
    try {
      setStatus("Deleting…");
      const path = section === "users" ? `/api/auth/users/${id}` : section === "roles" ? `/api/auth/roles/${id}` : `/api/auth/tokens/${id}`;
      await fetchJson(path, { method: "DELETE", token });
      await refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    }
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
        <button className="primary" onClick={() => void refresh()} aria-label={`Refresh ${title}`}><RefreshCw size={16} /> Refresh</button>
      </header>
      <div className="admin-grid">
        <section className="editor">
          <div className="editor-head">
            <div>
              <p className="eyebrow">Create</p>
              <h2>{title}</h2>
            </div>
            <button className="primary" onClick={() => void submit()} aria-label={`Save ${title}`}><Save size={16} /> Save</button>
          </div>
          <div className="fields">
            <label className="field"><span>ID</span><input name={`${section}-id`} autoComplete="off" value={form.id ?? ""} onChange={(event) => setForm((next) => ({ ...next, id: event.target.value }))} /></label>
            <label className="field"><span>Name</span><input name={`${section}-name`} autoComplete="off" value={form.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, name: event.target.value }))} /></label>
            {section === "users" ? <label className="field"><span>Email</span><input name="user-email" type="email" autoComplete="off" spellCheck={false} value={form.email ?? ""} onChange={(event) => setForm((next) => ({ ...next, email: event.target.value }))} /></label> : null}
            {section === "users" ? <label className="field"><span>Password</span><input name="user-password" type="password" autoComplete="new-password" value={form.password ?? ""} onChange={(event) => setForm((next) => ({ ...next, password: event.target.value }))} /></label> : null}
            {section !== "roles" ? <label className="field"><span>Roles</span><input name={`${section}-roles`} autoComplete="off" value={form.roles ?? ""} onChange={(event) => setForm((next) => ({ ...next, roles: event.target.value }))} placeholder="administrator,sales…" /></label> : null}
            <label className="field"><span>Permissions</span><input name={`${section}-permissions`} autoComplete="off" value={form.permissions ?? ""} onChange={(event) => setForm((next) => ({ ...next, permissions: event.target.value }))} placeholder="*,crm.customer.read…" /></label>
          </div>
          {createdToken ? <p className="token-copy">{createdToken}</p> : null}
        </section>
        <section className="list">
          <div className="list-head"><span>{items.length} records</span><span role="status" aria-live="polite">{status}</span></div>
          {items.map((item) => (
            <div key={item.id} className="row passive">
              <strong>{item.id}</strong>
              <span>{adminItemLabel(item)} · {item.permissions.join(", ") || "no permissions"}{"revokedAt" in item && item.revokedAt ? " · revoked" : ""}</span>
              <div className="row-actions"><button className="danger" onClick={() => void remove(item.id)}>Delete {item.id}</button></div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

export function OperationsPanel({ section, token, doctypes, status, setStatus, locale }: { section: "audit" | "outbox" | "diagnostics" | "customization" | "settings"; token: string; doctypes: DocTypeDefinition[]; status: string; setStatus: (status: string) => void; locale?: string }) {
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [outbox, setOutbox] = useState<OutboxEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>();
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PublicSetting[]>([]);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    void refresh();
  }, [section]);

  async function refresh() {
    try {
      setStatus("Syncing…");
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
      if (section === "settings") {
        const loaded = await fetchJson<PublicSetting[]>(`/api/settings${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`, { token });
        setSettings(loaded);
        setSettingDrafts(Object.fromEntries(loaded.filter((setting) => !setting.redacted && setting.value !== undefined).map((setting) => [setting.key, setting.value!] )));
      }
      setStatus("Ready");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function addCustomField() {
    try {
      setStatus("Saving…");
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
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function markOutbox(id: string, action: "dispatch" | "fail") {
    try {
      setStatus("Updating…");
      await fetchJson(`/api/outbox/${id}/${action}`, { method: "POST", token, body: action === "fail" ? { error: "Marked failed from Desk" } : undefined });
      await refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function saveSetting(setting: PublicSetting) {
    try {
      setStatus("Saving…");
      const draft = settingDrafts[setting.key];
      if (setting.type === "number" && (typeof draft !== "number" && (typeof draft !== "string" || draft.trim() === ""))) {
        setStatus("Enter a finite number before saving.");
        return;
      }
      const value = setting.type === "number" ? Number(draft) : setting.type === "boolean" ? Boolean(draft) : String(draft ?? "");
      if (setting.type === "number" && !Number.isFinite(value)) {
        setStatus("Enter a finite number before saving.");
        return;
      }
      await fetchJson(`/api/settings/${encodeURIComponent(setting.key)}`, { method: "PUT", token, body: { value } });
      setSettingDrafts((current) => ({ ...current, ...(setting.type === "secret" ? { [setting.key]: "" } : {}) }));
      await refresh();
      setStatus("Saved");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  const title = section === "audit" ? "Audit Trail" : section === "outbox" ? "Outbox" : section === "diagnostics" ? "Diagnostics" : section === "settings" ? "Settings" : "Customization";

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>{title}</h1>
        </div>
        <button className="primary" onClick={() => void refresh()} aria-label={`Refresh ${title}`}><RefreshCw size={16} /> Refresh</button>
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
              <label className="field"><span>DocType</span><select name="custom-doctype" value={form.doctype ?? doctypes[0]?.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, doctype: event.target.value }))}>{doctypes.map((doctype) => <option key={doctype.name} value={doctype.name}>{doctype.label}</option>)}</select></label>
              <label className="field"><span>Name</span><input name="custom-name" autoComplete="off" value={form.name ?? ""} onChange={(event) => setForm((next) => ({ ...next, name: event.target.value }))} /></label>
              <label className="field"><span>Label</span><input name="custom-label" autoComplete="off" value={form.label ?? ""} onChange={(event) => setForm((next) => ({ ...next, label: event.target.value }))} /></label>
              <label className="field"><span>Type</span><select name="custom-type" value={form.type ?? "text"} onChange={(event) => setForm((next) => ({ ...next, type: event.target.value }))}><option value="text">Text</option><option value="number">Number</option><option value="currency">Currency</option><option value="boolean">Boolean</option><option value="select">Select</option><option value="date">Date</option></select></label>
              <label className="field"><span>Options</span><input name="custom-options" autoComplete="off" value={form.options ?? ""} onChange={(event) => setForm((next) => ({ ...next, options: event.target.value }))} placeholder="open, won, lost…" /></label>
              <label className="field"><span>List Field</span><select name="custom-in-list" value={form.inList ?? "false"} onChange={(event) => setForm((next) => ({ ...next, inList: event.target.value }))}><option value="false">No</option><option value="true">Yes</option></select></label>
            </div>
          </section>
          <RecordList items={customFields.map((field) => ({ id: field.id, label: `${field.doctype}.${field.field.name}`, detail: `${field.field.label} · ${field.field.type}` }))} status={status} />
        </div>
      ) : null}

      {section === "settings" ? (
        <section className="editor">
          <div className="editor-head"><div><p className="eyebrow">Application settings</p><h2>Typed configuration</h2></div></div>
          {status ? <p role="status">{status}</p> : null}
          <div className="fields">
            {settings.map((setting) => (
              <label className="field" key={setting.key}>
                <span>{setting.label}{setting.required ? " *" : ""} · {setting.scope}</span>
                {setting.type === "boolean" ? <input type="checkbox" checked={Boolean(settingDrafts[setting.key])} onChange={(event) => setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.checked }))} />
                  : setting.type === "select" ? <select value={String(settingDrafts[setting.key] ?? "")} onChange={(event) => setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))}>{(setting.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>
                    : <input type={setting.type === "secret" ? "password" : setting.type === "number" ? "number" : "text"} value={String(settingDrafts[setting.key] ?? "")} placeholder={setting.redacted && setting.configured ? "Configured — enter to replace" : undefined} autoComplete={setting.type === "secret" ? "new-password" : "off"} onChange={(event) => setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))} />}
                {setting.description ? <small>{setting.description}</small> : null}
                <button type="button" onClick={() => void saveSetting(setting)}><Save size={15} /> Save {setting.label}</button>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {section === "audit" ? <RecordList items={audit.map((event) => ({ id: event.id, label: `${event.action} ${event.doctype}`, detail: `${event.documentId} · ${event.userId} · ${event.createdAt}` }))} status={status} /> : null}

      {section === "outbox" ? (
        <section className="list operation-list">
          <div className="list-head"><span>{outbox.length} events</span><span role="status" aria-live="polite">{status}</span></div>
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
            <div className="list-head"><span>{diagnostics.warnings.length} warnings</span><span role="status" aria-live="polite">{status}</span></div>
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
      <div className="list-head"><span>{items.length} records</span><span role="status" aria-live="polite">{status}</span></div>
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
