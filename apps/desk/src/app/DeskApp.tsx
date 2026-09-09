import { SecurityPanel } from "../sections/SecurityPanel";
import React from "react";
import { Activity, Boxes, Check, ChevronLeft, ChevronRight, Database, FileClock, FilePlus, KeyRound, LogOut, Radio, RefreshCw, Save, Search, Settings, Shield, Trash2, Users } from "lucide-react";
import type { DeskSection } from "../domain/types";
import { FieldInput } from "../components/FieldInput";
import { useDeskController } from "../state/useDeskController";
import { AdminPanel, OperationsPanel } from "../sections/Panels";

export function DeskApp() {
  const controller = useDeskController();
  const { authenticated, sessionChecked, loggingOut, email, setEmail, password, setPassword, signingIn, mfaChallenge, mfaCode, setMfaCode, recoveryCode, setRecoveryCode, cancelMfa, metadata, doctypes, active, section, setSection, setActiveDocType, records, hasNextPage, selected, draft, setDraft, ownerDraft, setOwnerDraft, query, setQuery, page, setPage, status, setStatus, listFields, formFields, availableTransitions, login, logout, refresh, selectRecord, save, uploadAttachment, deleteAttachment, transition, changeDocumentStatus, transferOwner, removeDocument, startNew } = controller;
  const message = (key: string, fallback: string) => metadata?.messages?.[key] ?? fallback;

  if (!sessionChecked) {
    return (
      <main className="login-shell" id="main-content">
        <section className="login-panel" aria-labelledby="session-title">
          <div className="mark"><Boxes size={24} /> Framekit</div>
          <p className="eyebrow">Desk sign in</p>
          <h1 id="session-title">Checking your session</h1>
          <p className="status" role="status" aria-live="polite">Loading authentication…</p>
        </section>
      </main>
    );
  }

  if (loggingOut) {
    return (
      <main className="login-shell" id="main-content">
        <section className="login-panel" aria-labelledby="logout-title">
          <div className="mark"><Boxes size={24} /> Framekit</div>
          <p className="eyebrow">Desk sign out</p>
          <h1 id="logout-title">Signing you out</h1>
          <p className="status" role="status" aria-live="polite">Ending the server session…</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="login-shell" id="main-content">
        <form className="login-panel" aria-labelledby="login-title" onSubmit={(event) => { event.preventDefault(); void login(); }}>
          <div className="mark"><Boxes size={24} /> Framekit</div>
          <p className="eyebrow">Desk sign in</p>
          <h1 id="login-title">Metadata operations console</h1>
          {mfaChallenge ? <>
            <label className="field"><span>{recoveryCode ? "Recovery code" : "Authenticator code"}</span><input autoFocus name="mfa-code" autoComplete="one-time-code" inputMode={recoveryCode ? "text" : "numeric"} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label>
            <label className="field"><span>Use a recovery code</span><input type="checkbox" checked={recoveryCode} onChange={(event) => { setRecoveryCode(event.target.checked); setMfaCode(""); }} /></label>
            <button type="submit" className="primary wide" disabled={signingIn}>Verify and sign in</button>
            <button type="button" onClick={cancelMfa}>Back to sign in</button>
          </> : <>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="username" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" className="primary wide" disabled={signingIn}><KeyRound size={16} /> Sign in</button>
          </>}
          <p className="status" role="status" aria-live="polite">{status}</p>
        </form>
      </main>
    );
  }

  return (
    <>
    <a className="skip-link" href="#desk-main">Skip to main content</a>
    <main className="desk">
      <aside className="rail">
        <div className="mark"><Boxes size={22} /> Framekit</div>
        <div className="version">{metadata?.name ?? "Metadata Desk"} · {metadata?.version ?? "0.1.0"}</div>
        <nav aria-label="Desk sections">
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
          <button className={section === "settings" ? "active" : ""} onClick={() => setSection("settings")}><Settings size={17} /><span>{message("desk.settings", "Settings")}</span></button>
          <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><FileClock size={17} /><span>Audit</span></button>
          <button className={section === "outbox" ? "active" : ""} onClick={() => setSection("outbox")}><Radio size={17} /><span>Outbox</span></button>
          <button className={section === "diagnostics" ? "active" : ""} onClick={() => setSection("diagnostics")}><Activity size={17} /><span>Diagnostics</span></button>
          <button className={section === "security" ? "active" : ""} onClick={() => setSection("security")}><Shield size={17} /><span>Account security</span></button>
          <button onClick={() => void logout()}><LogOut size={17} /><span>Sign out</span></button>
        </nav>
      </aside>

      <section className="workbench" aria-label="Desk workbench" id="desk-main" tabIndex={-1}>
        {section === "security" ? <SecurityPanel signOut={logout} /> : null}
        {section === "users" || section === "roles" || section === "tokens" ? <AdminPanel section={section} status={status} setStatus={setStatus} /> : null}
        {section === "audit" || section === "outbox" || section === "diagnostics" || section === "customization" || section === "settings" ? <OperationsPanel section={section} doctypes={doctypes} status={status} setStatus={setStatus} locale={metadata?.locale} /> : null}
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
              <input name="record-search" aria-label="Filter records" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Filter records…" />
            </label>
            <button onClick={() => void refresh()} aria-label="Refresh records"><RefreshCw size={16} /></button>
            <button onClick={startNew} aria-label="New document"><FilePlus size={16} /></button>
          </div>
        </header>

        <div className="grid">
          <section className="list">
            <div className="list-head">
              <span>{records.length} records</span>
              <span role="status" aria-live="polite">{status}</span>
            </div>
            {records.map((record) => (
              <button key={record.id} className={selected?.id === record.id ? "row selected" : "row"} onClick={() => selectRecord(record)}>
                <strong>{record.id}</strong>
                <span>{listFields.map((field) => String(record.data[field.name] ?? "")).filter(Boolean).join(" · ") || record.doctype}</span>
              </button>
            ))}
            <div className="pagination" aria-label="Record pagination">
              <button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} aria-label="Previous page"><ChevronLeft size={16} /> Previous</button>
              <span>Page {page + 1}</span>
              <button onClick={() => setPage((current) => current + 1)} disabled={!hasNextPage} aria-label="Next page">Next <ChevronRight size={16} /></button>
            </div>
          </section>

          <section className="editor">
            <div className="editor-head">
              <div>
                <p className="eyebrow">{selected ? selected.id : "New document"}</p>
                <h2>{active?.description ?? "Metadata-generated form"}</h2>
                {selected ? <small>Revision {selected.revision}</small> : null}
              </div>
              <div className="editor-actions">
                {selected?.documentStatus === "draft" ? <button onClick={() => void changeDocumentStatus("submit")}><Check size={16} /> Submit</button> : null}
                {selected?.documentStatus === "submitted" ? <button onClick={() => void changeDocumentStatus("cancel")}><Activity size={16} /> Cancel</button> : null}
                {selected?.documentStatus === "draft" ? <button className="danger" onClick={() => void removeDocument()}><Trash2 size={16} /> Delete</button> : null}
                <button className="primary" onClick={() => void save()} disabled={selected?.documentStatus !== undefined && selected.documentStatus !== "draft"}><Save size={16} /> Save</button>
              </div>
            </div>

            <div className="fields">
              {active?.ownership && selected ? (
                <label className="field">
                  <span>Owner</span>
                  <input aria-label="Owner" value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)} />
                  <button onClick={() => void transferOwner()} disabled={!ownerDraft.trim() || ownerDraft === selected.ownerId}>Transfer owner</button>
                </label>
              ) : null}
              {formFields.map((field) => (
                <label key={field.name} className="field">
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <FieldInput field={field} value={draft[field.name]} onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
                    canManageAttachments={Boolean(selected && selected.documentStatus === "draft")}
                    onUpload={(file) => void uploadAttachment(field, file)} onDeleteAttachment={(id) => void deleteAttachment(field, id)} />
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
    </>
  );
}
