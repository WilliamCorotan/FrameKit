import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DeskSection,
  DocumentRecord,
  FieldDefinition,
  Metadata,
  OwnerTransferReceipt
} from "../domain/types";
import { beginAuthGeneration, encodeBase64, errorMessage, fetchJson, requestLogout } from "../transport/client";
import { orderedFields, validDeskFieldValue } from "../validation/fields";

const pageSize = 5;

function removeLegacySessionToken() {
  try {
    window.localStorage.removeItem("framekit.token");
  } catch {
    // Storage can be unavailable in a privacy-restricted browser context.
  }
}

export function useDeskController() {
  const [authenticated, setAuthenticated] = useState(() => {
    removeLegacySessionToken();
    return false;
  });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const invalidateSessionRef = useRef<() => void>(() => undefined);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin12345");
  const [metadata, setMetadata] = useState<Metadata>();
  const [activeDocType, setActiveDocType] = useState("customer");
  const [section, setSection] = useState<DeskSection>("documents");
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [ownerDraft, setOwnerDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("Loading metadata");

  const doctypes = useMemo(
    () => metadata?.modules.flatMap((module) => module.doctypes) ?? [],
    [metadata]
  );
  const active = doctypes.find((doctype) => doctype.name === activeDocType) ?? doctypes[0];
  const message = (key: string, fallback: string) => metadata?.messages?.[key] ?? fallback;

  function clearSession() {
    beginAuthGeneration();
    setAuthenticated(false);
    setMetadata(undefined);
    setRecords([]);
    setSelected(undefined);
  }
  invalidateSessionRef.current = clearSession;

  useEffect(() => {
    const clear = () => invalidateSessionRef.current();
    window.addEventListener("framekit:unauthenticated", clear);
    return () => window.removeEventListener("framekit:unauthenticated", clear);
  }, []);

  useEffect(() => {
    void fetchJson("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    void fetchJson<Metadata>(`/api/meta?locale=${encodeURIComponent(navigator.language)}`)
      .then((next) => {
        setMetadata(next);
        setActiveDocType(next.modules.flatMap((module) => module.doctypes)[0]?.name ?? "customer");
        setStatus("Ready");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Failed to load metadata");
      });
  }, [authenticated]);

  useEffect(() => {
    if (active && section === "documents") {
      void refresh(active.name, query, page);
    }
  }, [active?.name, query, page, section]);

  async function login() {
    if (loggingOut) return;
    try {
      setStatus("Signing in…");
      beginAuthGeneration();
      await fetchJson("/api/auth/login", {
        method: "POST",
        body: { email, password }
      });
      setAuthenticated(true);
      setStatus("Ready");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setSessionChecked(true);
    }
  }

  async function logout() {
    beginAuthGeneration();
    removeLegacySessionToken();
    setLoggingOut(true);
    setAuthenticated(false);
    setMetadata(undefined);
    setRecords([]);
    setSelected(undefined);
    try {
      await requestLogout();
    } catch {
      // A stale remote session must not prevent local sign-out.
    } finally {
      setLoggingOut(false);
    }
  }

  async function refresh(doctype = activeDocType, search = query, targetPage = page) {
    try {
      setStatus("Syncing…");
      const params = new URLSearchParams({
        limit: String(pageSize + 1),
        offset: String(targetPage * pageSize)
      });
      if (search) {
        params.set("search", search);
      }
      const result = await fetchJson<DocumentRecord[]>(`/api/doctypes/${doctype}?${params}`);
      const list = result.slice(0, pageSize);
      setHasNextPage(result.length > pageSize);
      setRecords(list);
      selectRecord(list[0]);
      setStatus("Ready");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function selectRecord(record: DocumentRecord | undefined) {
    setSelected(record);
    setDraft(record?.data ?? {});
    setOwnerDraft(record?.ownerId ?? "");
  }

  async function save() {
    if (!active) {
      return;
    }
    try {
      setStatus("Saving…");
      const creating = !selected;
      const invalid = active.fields.find(
        (field) => !field.computed && field.type !== "attachments" && !validDeskFieldValue(field, draft[field.name])
      );
      if (invalid) {
        setStatus(`Invalid value for ${invalid.label}`);
        return;
      }
      const payload = { ...draft };
      for (const field of active.fields) {
        if (field.computed || field.type === "attachments") {
          delete payload[field.name];
        }
      }
      const record = selected
        ? await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}`, {
            method: "PATCH",
            body: payload,
            expectedRevision: selected.revision
          })
        : await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}`, {
            method: "POST",
            body: payload,
          });
      selectRecord(record);
      if (creating) {
        setPage(0);
      }
      await refresh(active.name, query, creating ? 0 : page);
      setStatus(message("desk.saved", "Saved"));
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function uploadAttachment(field: FieldDefinition, file: File) {
    if (!active || !selected) {
      return;
    }
    try {
      setStatus("Uploading…");
      await fetchJson(`/api/doctypes/${active.name}/${selected.id}/attachments/${field.name}`, {
        method: "POST",
        expectedRevision: selected.revision,
        body: {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          data: encodeBase64(new Uint8Array(await file.arrayBuffer()))
        }
      });
      selectRecord(await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}`));
      setStatus("Uploaded");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function deleteAttachment(field: FieldDefinition, attachmentId: string) {
    if (!active || !selected) {
      return;
    }
    try {
      setStatus("Deleting attachment…");
      await fetchJson(`/api/doctypes/${active.name}/${selected.id}/attachments/${field.name}/${attachmentId}`, {
        method: "DELETE",
        expectedRevision: selected.revision
      });
      selectRecord(await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}`));
      setStatus("Attachment deleted");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function transition(action: string) {
    if (!active || !selected) {
      return;
    }
    try {
      setStatus("Transitioning…");
      selectRecord(await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}/transition`, {
        method: "POST",
        body: { action }
      }));
      await refresh(active.name, query, page);
      setStatus("Transitioned");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function changeDocumentStatus(action: "submit" | "cancel") {
    if (!active || !selected) {
      return;
    }
    try {
      setStatus(action === "submit" ? "Submitting…" : "Cancelling…");
      selectRecord(await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${selected.id}/${action}`, {
        method: "POST",
        expectedRevision: selected.revision
      }));
      await refresh(active.name, query, page);
      setStatus(action === "submit" ? "Submitted" : "Cancelled");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function transferOwner() {
    if (!active?.ownership || !selected) {
      return;
    }
    try {
      setStatus("Transferring owner…");
      const receipt = await fetchJson<OwnerTransferReceipt>(`/api/doctypes/${active.name}/${selected.id}/owner`, {
        method: "POST",
        body: { ownerId: ownerDraft },
        expectedRevision: selected.revision
      });
      setRecords((current) => current.filter((record) => record.id !== receipt.id));
      selectRecord(undefined);
      try {
        const record = await fetchJson<DocumentRecord>(`/api/doctypes/${active.name}/${receipt.id}`);
        selectRecord(record);
        setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
        setStatus("Owner transferred");
      } catch {
        setStatus("Owner transferred; document is no longer readable");
      }
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function removeDocument() {
    if (!active || !selected || !window.confirm(`Delete ${selected.id}? This cannot be undone.`)) {
      return;
    }
    try {
      setStatus("Deleting…");
      await fetchJson(`/api/doctypes/${active.name}/${selected.id}`, { method: "DELETE" });
      const targetPage = records.length === 1 && page > 0 ? page - 1 : page;
      setPage(targetPage);
      await refresh(active.name, query, targetPage);
      setStatus(message("desk.deleted", "Deleted"));
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  const listFields = active
    ? orderedFields(
        active,
        active.views?.find((view) => view.type === "list")?.fields,
        active.fields.filter((field) => field.inList).map((field) => field.name)
      ).slice(0, 4)
    : [];
  const formFields = active
    ? orderedFields(
        active,
        active.views?.find((view) => view.type === "form")?.fields,
        active.fields.map((field) => field.name)
      )
    : [];
  const availableTransitions = active?.workflow && selected?.documentStatus === "draft"
    ? active.workflow.transitions.filter((transition) => transition.from.includes(selected.state ?? active.workflow!.initialState))
    : [];

  return {
    authenticated,
    sessionChecked,
    loggingOut,
    email,
    setEmail,
    password,
    setPassword,
    metadata,
    doctypes,
    active,
    activeDocType,
    setActiveDocType,
    section,
    setSection,
    records,
    hasNextPage,
    selected,
    draft,
    setDraft,
    ownerDraft,
    setOwnerDraft,
    query,
    setQuery,
    page,
    setPage,
    status,
    setStatus,
    listFields,
    formFields,
    availableTransitions,
    login,
    logout,
    refresh,
    selectRecord,
    save,
    uploadAttachment,
    deleteAttachment,
    transition,
    changeDocumentStatus,
    transferOwner,
    removeDocument,
    startNew: () => selectRecord(undefined)
  };
}
