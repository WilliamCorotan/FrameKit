import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FramekitClient, FramekitSdkError, type HealthResponse } from "@framekit/sdk";

type CustomerData = {
  name?: string;
  status?: "active" | "paused" | string;
  owner?: string;
  annual_revenue?: string | number;
};

type Customer = { id: string; revision: number; data: CustomerData };
type CustomerForm = { name: string; status: "active" | "paused"; owner: string; annual_revenue: string };
type LedgerMeta = { name?: string; modules?: Array<{ doctypes?: unknown[] }> };

const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL?.replace(/\/$/, "") ?? "";
const emptyForm: CustomerForm = { name: "", status: "active", owner: "Sales", annual_revenue: "0.00" };

function createClient() {
  return new FramekitClient({
    version: 2,
    baseUrl: apiUrl,
    authMode: "bearer",
    tenant: { tenantId: "default", userId: "administrator", roles: ["administrator"], permissions: ["*"] }
  });
}

export function App() {
  const clientRef = useRef(createClient());
  const generationRef = useRef(0);
  const listControllerRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [health, setHealth] = useState<HealthResponse>();
  const [meta, setMeta] = useState<LedgerMeta>();
  const [healthLoading, setHealthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>();
  const [form, setForm] = useState<CustomerForm>(emptyForm);

  const isCurrent = useCallback((generation: number, client: FramekitClient) => (
    mountedRef.current && generationRef.current === generation && clientRef.current === client
  ), []);

  const loadLedger = useCallback(async (client: FramekitClient, generation: number) => {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    if (!isCurrent(generation, client)) return;
    setLoading(true);
    setError(undefined);
    try {
      const [nextMeta, page] = await Promise.all([
        client.meta<LedgerMeta>(),
        client.listPage<CustomerData>("customer", { limit: 20, signal: controller.signal })
      ]);
      if (isCurrent(generation, client) && !controller.signal.aborted) {
        setMeta(nextMeta);
        setCustomers(page.items);
      }
    } catch (failure) {
      if (isCurrent(generation, client) && !controller.signal.aborted) setError(failure);
    } finally {
      if (isCurrent(generation, client) && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    const client = clientRef.current;
    void client.health({ signal: controller.signal }).then((nextHealth) => {
      if (mountedRef.current && clientRef.current === client) setHealth(nextHealth);
    }).catch((failure: unknown) => {
      if (mountedRef.current && !controller.signal.aborted && clientRef.current === client) setError(failure);
    }).finally(() => {
      if (mountedRef.current && !controller.signal.aborted && clientRef.current === client) setHealthLoading(false);
    });
    return () => {
      mountedRef.current = false;
      controller.abort();
      listControllerRef.current?.abort();
      generationRef.current += 1;
    };
  }, []);

  const refresh = () => {
    const client = clientRef.current;
    const generation = generationRef.current;
    setRefreshing(true);
    void loadLedger(client, generation);
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    listControllerRef.current?.abort();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const client = createClient();
    clientRef.current = client;
    setSigningIn(true);
    setError(undefined);
    try {
      await client.login(email, password);
      if (!isCurrent(generation, client)) return;
      setSignedIn(true);
      await loadLedger(client, generation);
    } catch (failure) {
      if (isCurrent(generation, client)) setError(failure);
    } finally {
      if (isCurrent(generation, client)) setSigningIn(false);
    }
  };

  const logout = async () => {
    const client = clientRef.current;
    listControllerRef.current?.abort();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      await client.logout();
    } catch (failure) {
      if (mountedRef.current && generationRef.current === generation) setError(failure);
    } finally {
      if (generationRef.current !== generation) return;
      clientRef.current = createClient();
      if (mountedRef.current) {
        setSignedIn(false);
        setCustomers([]);
        setMeta(undefined);
        setForm(emptyForm);
        setLoading(false);
        setRefreshing(false);
        setCreating(false);
      }
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const client = clientRef.current;
    const generation = generationRef.current;
    setCreating(true);
    setError(undefined);
    try {
      await client.create<CustomerData>("customer", {
        name: form.name.trim(), status: form.status, owner: form.owner.trim(), annual_revenue: form.annual_revenue
      }, { idempotencyKey: crypto.randomUUID() });
      if (!isCurrent(generation, client)) return;
      setForm(emptyForm);
      await loadLedger(client, generation);
    } catch (failure) {
      if (isCurrent(generation, client)) setError(failure);
    } finally {
      if (isCurrent(generation, client)) setCreating(false);
    }
  };

  const appName = meta?.name ?? health?.app ?? "Framekit";
  const doctypeCount = meta?.modules?.flatMap((module) => module.doctypes ?? []).length ?? 0;
  const detail = useMemo(() => describeError(error), [error]);

  return <main className="ledger-shell">
    <header className="masthead enter">
      <p className="eyebrow">{appName} / customer registry</p>
      <div className="masthead-row">
        <h1>Field<br /><em>Ledger</em></h1>
        <div className="system-stamp" aria-label={health ? "API health: online" : "API health: checking"}>
          <span className={health ? "pulse online" : "pulse"} />
          <span>{health ? "live / verified" : healthLoading ? "live / checking" : "live / unavailable"}</span>
          <small>{apiUrl || "same-origin API proxy"}</small>
        </div>
      </div>
    </header>

    <section className="ledger-grid">
      <aside className="margin-note enter delay-1">
        <p>Register companies, record stewardship, and keep a small, legible account of the work ahead.</p>
        <dl>
          <div><dt>Tenant</dt><dd>default</dd></div>
          <div><dt>Doctype</dt><dd>customer</dd></div>
          <div><dt>Schema</dt><dd>{doctypeCount || "—"} entries</dd></div>
        </dl>
      </aside>

      <section className="records enter delay-2" aria-labelledby="records-title">
        <div className="section-heading">
          <div><p className="eyebrow">folio 01</p><h2 id="records-title">Customer register</h2></div>
          {signedIn && <div className="action-pair"><button className="text-button" onClick={refresh} disabled={loading || refreshing}>
              {refreshing ? "Refreshing…" : "Refresh list"}
            </button><button className="text-button" onClick={() => void logout()}>Sign out</button></div>}
        </div>

        {detail && <ErrorNotice detail={detail} />}
        {!signedIn && <p className="state-message">Sign in to read and add customer records. Your session remains only in this browser tab’s memory.</p>}
        {signedIn && loading && <p className="state-message" role="status">Opening the register…</p>}
        {signedIn && !loading && !detail && customers.length === 0 && <p className="state-message">No customers entered yet. The first line is waiting.</p>}
        {signedIn && !loading && !detail && customers.length > 0 && <div className="table-wrap">
          <table><thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead>
            <tbody>{customers.map((customer) => <tr key={customer.id}>
              <td><strong>{customer.data.name ?? "Untitled"}</strong><small>{customer.id}</small></td>
              <td><span className={`status ${customer.data.status === "active" ? "active" : "paused"}`}>{customer.data.status ?? "—"}</span></td>
              <td>{customer.data.owner ?? "—"}</td><td>{formatRevenue(customer.data.annual_revenue)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>

      <section className="entry-form enter delay-3" aria-labelledby="entry-title">
        <p className="eyebrow">folio 02 / {signedIn ? "new line" : "access"}</p><h2 id="entry-title">{signedIn ? "Enter a customer" : "Sign in"}</h2>
        {!signedIn ? <form key="sign-in" onSubmit={signIn}>
          <label>Email <input name="email" type="email" autoComplete="username" defaultValue="admin@example.com" required /></label>
          <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="submit-button" disabled={signingIn}>{signingIn ? "Signing in…" : "Open ledger"}</button>
        </form> : <form key="customer-entry" onSubmit={submit}>
          <label>Name <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <div className="form-pair"><label>Status <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CustomerForm["status"] })}><option value="active">Active</option><option value="paused">Paused</option></select></label>
            <label>Owner <input required value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label></div>
          <label>Annual revenue <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.annual_revenue} onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} /></label>
          <button className="submit-button" disabled={creating}>{creating ? "Entering…" : "Add to ledger"}</button>
        </form>}
      </section>
    </section>
  </main>;
}

function ErrorNotice({ detail }: { detail: string }) {
  return <div className="error-notice" role="alert"><strong>Request recorded as incomplete.</strong><span>{detail}</span></div>;
}

function describeError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof FramekitSdkError) {
    return `${error.name} · ${error.code}${error.status ? ` · HTTP ${error.status}` : ""}${error.requestId ? ` · request ${error.requestId}` : ""}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "An unknown error interrupted the request.";
}

function formatRevenue(value: CustomerData["annual_revenue"]): string {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number) : "—";
}
