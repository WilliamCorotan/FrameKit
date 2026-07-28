import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { FramekitSdkError, type HealthResponse } from "@framekit/sdk";
import { clearClientSession, client, framekitApp } from "./api";

type Customer = {
  name?: string;
  status?: string;
  owner?: string;
  annual_revenue?: string;
};

type FormValues = Required<Customer>;
type CustomerRecord = { id: string; data: Customer };
type RequestGuard = { generation: number; controller: AbortController };

const initialForm: FormValues = { name: "", status: "active", owner: "", annual_revenue: "0.00" };

function messageFor(error: unknown): string {
  if (error instanceof FramekitSdkError) {
    const request = error.requestId ? ` Request: ${error.requestId}.` : "";
    return `${error.code}${error.status ? ` (${error.status})` : ""}: ${error.message}.${request}`;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `solid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revenue(value: string | undefined): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : "—";
}

export function App() {
  const [customers, setCustomers] = createSignal<CustomerRecord[]>([]);
  const [health, setHealth] = createSignal<HealthResponse>();
  const [metadata, setMetadata] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(true);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [signingIn, setSigningIn] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [success, setSuccess] = createSignal<string>();
  const [form, setForm] = createSignal<FormValues>(initialForm);
  const [email, setEmail] = createSignal("admin@example.com");
  const [password, setPassword] = createSignal("");
  let mounted = true;
  let sessionGeneration = 0;
  const activeControllers = new Set<AbortController>();

  const beginRequest = (): RequestGuard => {
    const controller = new AbortController();
    activeControllers.add(controller);
    return { generation: sessionGeneration, controller };
  };

  const finishRequest = (request: RequestGuard): void => {
    activeControllers.delete(request.controller);
  };

  const isCurrent = (request: RequestGuard): boolean => mounted && request.generation === sessionGeneration && !request.controller.signal.aborted;

  const invalidateSession = (): void => {
    sessionGeneration += 1;
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
  };

  const checkHealth = async () => {
    const request = beginRequest();
    setLoading(true);
    try {
      const nextHealth = await client.health({ signal: request.controller.signal });
      if (isCurrent(request)) setHealth(nextHealth);
    } catch (cause) {
      if (isCurrent(request)) setError(messageFor(cause));
    } finally {
      if (isCurrent(request)) setLoading(false);
      finishRequest(request);
    }
  };

  const load = async () => {
    if (!authenticated()) return;
    const request = beginRequest();
    setLoading(true);
    setError(undefined);
    try {
      const [nextMetadata, page] = await Promise.all([
        client.meta(),
        client.listPage<Customer>("customer", { limit: 25, sort: { field: "name", direction: "asc" }, signal: request.controller.signal })
      ]);
      if (isCurrent(request)) {
        setMetadata(nextMetadata);
        setCustomers(page.items);
      }
    } catch (cause) {
      if (isCurrent(request)) setError(messageFor(cause));
    } finally {
      if (isCurrent(request)) setLoading(false);
      finishRequest(request);
    }
  };

  const signIn = async (event: SubmitEvent) => {
    event.preventDefault();
    invalidateSession();
    const request = beginRequest();
    setSigningIn(true);
    setError(undefined);
    try {
      await client.login(email(), password());
      if (!isCurrent(request)) return;
      setAuthenticated(true);
      setPassword("");
      setSuccess("Signed in. Customer records are ready.");
      setSigningIn(false);
      void load();
    } catch (cause) {
      if (isCurrent(request)) {
        setError(messageFor(cause));
        setSigningIn(false);
      }
    } finally {
      finishRequest(request);
    }
  };

  const signOut = async () => {
    const logoutClient = client;
    invalidateSession();
    const logoutGeneration = sessionGeneration;
    clearClientSession();
    setError(undefined);
    setAuthenticated(false);
    setCustomers([]);
    setMetadata(undefined);
    setSuccess(undefined);
    setLoading(false);
    setSigningIn(false);
    setSubmitting(false);
    try {
      await logoutClient.logout();
    } catch (cause) {
      if (mounted && sessionGeneration === logoutGeneration) setError(messageFor(cause));
    } finally {
      // The active client was replaced before logout so late responses cannot revive a session.
    }
  };

  const createCustomer = async (event: SubmitEvent) => {
    event.preventDefault();
    const request = beginRequest();
    setSubmitting(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const value = form();
      const customer = await client.create<Customer>("customer", value, { idempotencyKey: idempotencyKey(), signal: request.controller.signal });
      if (isCurrent(request)) {
        setCustomers((current) => [customer, ...current]);
        setForm(initialForm);
        setSuccess(`${customer.data.name || "Customer"} added to the ledger.`);
      }
    } catch (cause) {
      if (isCurrent(request)) setError(messageFor(cause));
    } finally {
      if (isCurrent(request)) setSubmitting(false);
      finishRequest(request);
    }
  };

  onMount(() => {
    void checkHealth();
    onCleanup(() => {
      mounted = false;
      invalidateSession();
    });
  });

  return <main class="ledger-shell">
    <header class="masthead">
      <p class="eyebrow">Framekit / {framekitApp}</p>
      <h1>Customer<br /><em>ledger</em></h1>
      <div class="system-note" aria-live="polite">
        <span class={health()?.ok ? "status-dot online" : "status-dot"} />
        <span>{health()?.ok ? `${health()!.app} responding` : loading() ? "checking system" : "connection unknown"}</span>
      </div>
    </header>

    <section class="intro" aria-label="Ledger overview">
      <p>New accounts, kept in plain sight. Live data from the Framekit API—not a stored session.</p>
      <Show when={authenticated()} fallback={<span class="signin-prompt">Sign in to open the ledger</span>}>
        <div class="actions"><button class="text-button" type="button" onClick={load} disabled={loading()}>{loading() ? "Refreshing…" : "Refresh ledger"}</button><button class="text-button" type="button" onClick={signOut}>Sign out</button></div>
      </Show>
    </section>

    <Show when={error()}>{(value) => <p class="notice error" role="alert">{value()}</p>}</Show>
    <Show when={success()}>{(value) => <p class="notice success" role="status">{value()}</p>}</Show>

    <Show when={authenticated()} fallback={<section class="signin-panel" aria-labelledby="signin-title">
      <div><p class="eyebrow">Account access</p><h2 id="signin-title">Open the<br /><em>ledger</em></h2><p>Use a Framekit account to retrieve protected customer records. Your bearer token stays only in this page’s memory.</p></div>
      <form class="signin-form" onSubmit={signIn}>
        <label>Email <input required type="email" autocomplete="email" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} /></label>
        <label>Password <input required type="password" autocomplete="current-password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} /></label>
        <button class="submit-button" type="submit" disabled={signingIn()}>{signingIn() ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>}>
    <section class="ledger-grid">
      <form class="new-entry" onSubmit={createCustomer}>
        <div class="section-heading"><span>01</span><h2>New entry</h2></div>
        <label>Name <input required value={form().name} onInput={(event) => setForm({ ...form(), name: event.currentTarget.value })} placeholder="Northstar Studio" /></label>
        <label>Status <select value={form().status} onChange={(event) => setForm({ ...form(), status: event.currentTarget.value })}><option value="active">Active</option><option value="paused">Paused</option></select></label>
        <label>Owner <input required value={form().owner} onInput={(event) => setForm({ ...form(), owner: event.currentTarget.value })} placeholder="Avery Chen" /></label>
        <label>Annual revenue <input required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form().annual_revenue} onInput={(event) => setForm({ ...form(), annual_revenue: event.currentTarget.value })} /></label>
        <button class="submit-button" type="submit" disabled={submitting()}>{submitting() ? "Recording…" : "Record customer"}</button>
        <p class="form-note">Each submission includes a fresh idempotency key.</p>
      </form>

      <section class="entries" aria-busy={loading()}>
        <div class="section-heading"><span>02</span><h2>Accounts on record</h2><span class="count">{customers().length}</span></div>
        <Show when={!loading()} fallback={<p class="state">Loading customer records…</p>}>
          <Show when={customers().length > 0} fallback={<p class="state">No customers yet. Make the first entry.</p>}>
            <div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead><tbody><For each={customers()}>{(customer) => <tr><td><strong>{customer.data.name || "Untitled"}</strong><small>{customer.id}</small></td><td><span class="pill">{customer.data.status || "—"}</span></td><td>{customer.data.owner || "—"}</td><td class="money">{revenue(customer.data.annual_revenue)}</td></tr>}</For></tbody></table></div>
          </Show>
        </Show>
      </section>
    </section>
    </Show>

    <footer><span>Metadata {metadata() ? "loaded" : "pending"}</span><span>v2 client · default tenant</span></footer>
  </main>;
}
