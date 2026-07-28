<script lang="ts">
  import {
    FramekitAuthenticationError,
    FramekitAuthorizationError,
    FramekitConflictError,
    FramekitSdkError,
    FramekitServerError,
    FramekitTransportError,
    FramekitValidationError,
    FramekitClient
  } from "@framekit/sdk";
  import { onDestroy, onMount } from "svelte";

  type CustomerData = {
    name: string;
    status: "active" | "paused";
    owner: string;
    annual_revenue: string;
  };

  type CustomerRecord = {
    id: string;
    data: CustomerData;
  };

  type MetaSnapshot = { app?: { name?: string; version?: string }; name?: string; version?: string };

  const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "";
  const tenantId = import.meta.env.VITE_FRAMEKIT_TENANT_ID ?? "default";
  const appName = import.meta.env.VITE_FRAMEKIT_APP_NAME ?? "CRM";
  const userId = import.meta.env.VITE_FRAMEKIT_USER_ID ?? "frontend";
  function createClient() {
    return new FramekitClient({
      version: 2,
      baseUrl: apiUrl,
      authMode: "bearer",
      tenant: { tenantId, userId, roles: ["administrator"], permissions: ["*"] }
    });
  }

  let client = createClient();
  let sessionGeneration = 0;
  let mounted = true;
  let refreshController: AbortController | null = null;
  let createController: AbortController | null = null;

  let customers = $state<CustomerRecord[]>([]);
  let health = $state<"checking" | "online" | "offline">("checking");
  let meta = $state<MetaSnapshot | null>(null);
  let loading = $state(false);
  let submitting = $state(false);
  let authenticating = $state(false);
  let signedIn = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let name = $state("");
  let status = $state<CustomerData["status"]>("active");
  let owner = $state("Sales");
  let annualRevenue = $state("0.00");
  let email = $state("admin@example.com");
  let password = $state("");

  onMount(() => {
    void checkHealth();
  });

  onDestroy(() => {
    mounted = false;
    invalidateSession();
  });

  function abortProtectedRequests() {
    refreshController?.abort();
    createController?.abort();
    refreshController = null;
    createController = null;
  }

  function invalidateSession() {
    sessionGeneration += 1;
    abortProtectedRequests();
  }

  function isCurrent(generation: number, requestClient: FramekitClient) {
    return mounted && generation === sessionGeneration && client === requestClient;
  }

  async function checkHealth() {
    const generation = sessionGeneration;
    const requestClient = client;
    health = "checking";
    try {
      const healthResponse = await requestClient.health();
      if (!isCurrent(generation, requestClient)) return;
      health = healthResponse.ok ? "online" : "offline";
    } catch (cause) {
      if (!isCurrent(generation, requestClient)) return;
      health = "offline";
      error = presentError(cause);
    }
  }

  async function refresh() {
    if (!signedIn) return;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    const generation = sessionGeneration;
    const requestClient = client;
    loading = true;
    error = null;
    notice = null;
    try {
      const [metaResponse, page] = await Promise.all([
        requestClient.meta<MetaSnapshot>(),
        requestClient.listPage<CustomerData>("customer", { limit: 50, sort: { field: "name", direction: "asc" }, signal: controller.signal })
      ]);
      if (!isCurrent(generation, requestClient) || controller.signal.aborted) return;
      meta = metaResponse;
      customers = page.items;
    } catch (cause) {
      if (!isCurrent(generation, requestClient) || controller.signal.aborted) return;
      error = presentError(cause);
    } finally {
      if (isCurrent(generation, requestClient) && refreshController === controller) {
        refreshController = null;
        loading = false;
      }
    }
  }

  async function signIn() {
    invalidateSession();
    const generation = sessionGeneration;
    const loginClient = createClient();
    client = loginClient;
    authenticating = true;
    error = null;
    notice = null;
    try {
      await loginClient.login(email, password);
      if (!isCurrent(generation, loginClient)) return;
      password = "";
      signedIn = true;
      notice = "Signed in. Loading the customer ledger.";
      await refresh();
    } catch (cause) {
      if (!isCurrent(generation, loginClient)) return;
      password = "";
      signedIn = false;
      error = presentError(cause);
    } finally {
      if (isCurrent(generation, loginClient)) authenticating = false;
    }
  }

  async function signOut() {
    const logoutClient = client;
    invalidateSession();
    error = null;
    notice = null;
    try {
      await logoutClient.logout();
      if (mounted) notice = "Signed out. Your session was cleared from memory.";
    } catch (cause) {
      if (mounted) error = presentError(cause);
    } finally {
      client = createClient();
      if (!mounted) return;
      signedIn = false;
      customers = [];
      meta = null;
      password = "";
      loading = false;
      submitting = false;
    }
  }

  async function createCustomer() {
    if (!name.trim()) {
      error = "A customer name is required before an entry can be posted.";
      return;
    }
    createController?.abort();
    const controller = new AbortController();
    createController = controller;
    const generation = sessionGeneration;
    const requestClient = client;
    submitting = true;
    error = null;
    notice = null;
    const idempotencyKey = crypto.randomUUID();
    try {
      const customer = await requestClient.create<CustomerData>("customer", {
        name: name.trim(),
        status,
        owner: owner.trim() || "Sales",
        annual_revenue: annualRevenue.trim() || "0.00"
      }, { idempotencyKey, signal: controller.signal });
      if (!isCurrent(generation, requestClient) || controller.signal.aborted) return;
      customers = [customer, ...customers];
      name = "";
      status = "active";
      owner = "Sales";
      annualRevenue = "0.00";
      notice = `Entry ${customer.id} posted to the ledger.`;
    } catch (cause) {
      if (!isCurrent(generation, requestClient) || controller.signal.aborted) return;
      error = presentError(cause);
    } finally {
      if (isCurrent(generation, requestClient) && createController === controller) {
        createController = null;
        submitting = false;
      }
    }
  }

  function presentError(cause: unknown): string {
    if (cause instanceof FramekitValidationError) return `Validation (${cause.code}): ${cause.message}`;
    if (cause instanceof FramekitAuthenticationError) return `Authentication (${cause.status ?? "no status"}): ${cause.message}`;
    if (cause instanceof FramekitAuthorizationError) return `Permission denied (${cause.code}): ${cause.message}`;
    if (cause instanceof FramekitConflictError) return `Conflict (${cause.code}): ${cause.message}`;
    if (cause instanceof FramekitServerError) return `Server error (${cause.status ?? "unknown"}): ${cause.message}`;
    if (cause instanceof FramekitTransportError) return `Connection failed: ${cause.message}`;
    if (cause instanceof FramekitSdkError) return `Framekit ${cause.code}: ${cause.message}`;
    return cause instanceof Error ? cause.message : "An unexpected error interrupted the request.";
  }

  function money(value: unknown): string {
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : "—";
  }
</script>

<svelte:head><title>Customer Ledger · {appName}</title></svelte:head>

<main class="ledger-shell">
  <header class="masthead entry entry-one">
    <p class="kicker"><span class="signal" aria-hidden="true"></span> Framekit / {appName}</p>
    <div class="masthead-row">
      <h1>Customer<br /><em>ledger.</em></h1>
      <div class="terminal" aria-label="Connection details">
        <span class:online={health === "online"} class:offline={health === "offline"} class="status-dot"></span>
        <span>{health === "checking" ? "checking node" : health === "online" ? "node live" : "node unavailable"}</span>
        <small>{apiUrl || "same-origin API proxy"}</small>
      </div>
    </div>
  </header>

  <section class="context entry entry-two" aria-label="Ledger context">
    <p>Tenant <strong>{tenantId}</strong> / operator <strong>{userId}</strong></p>
    <p>{meta?.app?.name ?? meta?.name ?? appName}{meta?.app?.version ?? meta?.version ? ` · ${meta.app?.version ?? meta.version}` : ""}</p>
    {#if signedIn}
      <div class="context-actions">
        <button class="refresh" onclick={refresh} disabled={loading} aria-label="Refresh customer ledger"><span aria-hidden="true">↻</span> {loading ? "Refreshing" : "Refresh"}</button>
        <button class="refresh" onclick={() => void signOut()} aria-label="Sign out">Sign out</button>
      </div>
    {:else}
      <span class="auth-prompt">Sign in to open ledger</span>
    {/if}
  </section>

  {#if error}
    <div class="message error" role="alert"><b>Request note</b><span>{error}</span></div>
  {/if}
  {#if notice}
    <div class="message success" role="status"><b>Posted</b><span>{notice}</span></div>
  {/if}

  <div class="ledger-grid">
    <section class="register entry entry-three" aria-labelledby="register-title" aria-busy={loading}>
      <div class="section-title">
        <p class="kicker">01 / register</p>
        <h2 id="register-title">Accounts on file <sup>{customers.length}</sup></h2>
      </div>

      {#if !signedIn}
        <div class="empty-state"><span>↗</span><h3>Identity required.</h3><p>Health is public. The customer register opens after a bearer sign-in.</p></div>
      {:else if loading}
        <div class="loading-lines" aria-label="Loading customers"><i></i><i></i><i></i></div>
      {:else if customers.length === 0}
        <div class="empty-state"><span>∅</span><h3>The ledger is clear.</h3><p>Make the first customer entry at right.</p></div>
      {:else}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead>
            <tbody>
              {#each customers as customer (customer.id)}
                <tr>
                  <td><strong>{customer.data.name}</strong><small>{customer.id}</small></td>
                  <td><span class:paused={customer.data.status === "paused"} class="badge">{customer.data.status}</span></td>
                  <td>{customer.data.owner}</td>
                  <td class="revenue">{money(customer.data.annual_revenue)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <aside class="entry-form entry entry-four" aria-labelledby="entry-title">
      {#if signedIn}
        <p class="kicker">02 / new entry</p>
        <h2 id="entry-title">Add a customer</h2>
        <p class="form-intro">Each post carries a fresh idempotency key, so a retry stays one entry.</p>
        <form onsubmit={(event) => { event.preventDefault(); void createCustomer(); }}>
          <label>Name <input bind:value={name} autocomplete="organization" required placeholder="Acme Supply Co." /></label>
          <label>Status <select bind:value={status}><option value="active">Active</option><option value="paused">Paused</option></select></label>
          <label>Owner <input bind:value={owner} autocomplete="name" /></label>
          <label>Annual revenue <span class="input-affix">USD</span><input bind:value={annualRevenue} inputmode="decimal" placeholder="0.00" /></label>
          <button class="post" type="submit" disabled={submitting}>{submitting ? "Posting entry…" : "Post to ledger"} <span aria-hidden="true">→</span></button>
        </form>
      {:else}
        <p class="kicker">02 / access</p>
        <h2 id="entry-title">Sign in</h2>
        <p class="form-intro">Use a Framekit account to read and post customer records. Credentials stay in this form only.</p>
        <form onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
          <label>Email <input bind:value={email} type="email" autocomplete="username" required /></label>
          <label>Password <input bind:value={password} type="password" autocomplete="current-password" required /></label>
          <button class="post" type="submit" disabled={authenticating}>{authenticating ? "Signing in…" : "Open ledger"} <span aria-hidden="true">→</span></button>
        </form>
      {/if}
    </aside>
  </div>

  <footer><span>Framekit SDK v2</span><span>Customer doctype / direct API example</span></footer>
</main>
