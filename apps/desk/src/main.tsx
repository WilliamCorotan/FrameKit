import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Boxes, Check, Database, FilePlus, RefreshCw, Save, Search } from "lucide-react";
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

const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "http://localhost:3000";

function App() {
  const [metadata, setMetadata] = useState<Metadata | undefined>();
  const [activeDocType, setActiveDocType] = useState("customer");
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [selected, setSelected] = useState<DocumentRecord | undefined>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading metadata");

  const doctypes = useMemo(() => metadata?.modules.flatMap((module) => module.doctypes) ?? [], [metadata]);
  const active = doctypes.find((doctype) => doctype.name === activeDocType) ?? doctypes[0];

  useEffect(() => {
    fetchJson<Metadata>("/api/meta")
      .then((next) => {
        setMetadata(next);
        setActiveDocType(next.modules.flatMap((module) => module.doctypes)[0]?.name ?? "customer");
        setStatus("Ready");
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Failed to load metadata"));
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh(active.name, query);
  }, [active?.name, query]);

  async function refresh(doctype = activeDocType, search = query) {
    setStatus("Syncing");
    const suffix = search ? `?search=${encodeURIComponent(search)}` : "";
    const list = await fetchJson<DocumentRecord[]>(`/api/doctypes/${doctype}${suffix}`);
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
      ? await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}`, { method: "PATCH", body: draft })
      : await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}`, { method: "POST", body: draft });
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
    const record = await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}/transition`, { method: "POST", body: { action } });
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

  return (
    <main className="desk">
      <aside className="rail">
        <div className="mark"><Boxes size={22} /> Framekit</div>
        <div className="version">{metadata?.name ?? "Metadata Desk"} · {metadata?.version ?? "0.1.0"}</div>
        <nav>
          {doctypes.map((doctype) => (
            <button key={doctype.name} className={doctype.name === active?.name ? "active" : ""} onClick={() => setActiveDocType(doctype.name)}>
              <Database size={17} />
              <span>{doctype.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workbench">
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
      </section>
    </main>
  );
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

async function fetchJson<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "default",
      "x-user-id": "desk",
      "x-roles": "administrator",
      "x-permissions": "*"
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

createRoot(document.getElementById("root")!).render(<App />);
