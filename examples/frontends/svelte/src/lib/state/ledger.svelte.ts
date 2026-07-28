import type { FramekitClient } from "@framekit/sdk";
import { createFramekitClient, type MetaSnapshot, presentFramekitError } from "../api/framekit";
import type { CustomerData, CustomerRecord } from "../domain/customer";

function createLedger() {
  let client = createFramekitClient();
  let generation = 0;
  let mounted = false;
  let refreshController: AbortController | null = null;
  let createController: AbortController | null = null;

  const state = $state({
    customers: [] as CustomerRecord[], health: "checking" as "checking" | "online" | "offline", meta: null as MetaSnapshot | null,
    loading: false, submitting: false, authenticating: false, signedIn: false, error: null as string | null, notice: null as string | null,
    name: "", status: "active" as CustomerData["status"], owner: "Sales", annualRevenue: "0.00", email: "admin@example.com", password: ""
  });

  function abortProtectedRequests() { refreshController?.abort(); createController?.abort(); refreshController = null; createController = null; }
  function invalidateSession() { generation += 1; abortProtectedRequests(); }
  function isCurrent(requestGeneration: number, requestClient: FramekitClient) { return mounted && requestGeneration === generation && client === requestClient; }

  async function checkHealth() {
    const requestGeneration = generation; const requestClient = client; state.health = "checking";
    try { const response = await requestClient.health(); if (isCurrent(requestGeneration, requestClient)) state.health = response.ok ? "online" : "offline"; }
    catch (cause) { if (isCurrent(requestGeneration, requestClient)) { state.health = "offline"; state.error = presentFramekitError(cause); } }
  }

  async function refresh() {
    if (!state.signedIn) return;
    refreshController?.abort(); const controller = new AbortController(); refreshController = controller;
    const requestGeneration = generation; const requestClient = client; state.loading = true; state.error = null; state.notice = null;
    try {
      const [meta, page] = await Promise.all([requestClient.meta<MetaSnapshot>(), requestClient.listPage<CustomerData>("customer", { limit: 50, sort: { field: "name", direction: "asc" }, signal: controller.signal })]);
      if (!isCurrent(requestGeneration, requestClient) || controller.signal.aborted) return;
      state.meta = meta; state.customers = page.items;
    } catch (cause) { if (isCurrent(requestGeneration, requestClient) && !controller.signal.aborted) state.error = presentFramekitError(cause); }
    finally { if (isCurrent(requestGeneration, requestClient) && refreshController === controller) { refreshController = null; state.loading = false; } }
  }

  async function signIn() {
    invalidateSession(); const requestGeneration = generation; const loginClient = createFramekitClient(); client = loginClient;
    state.authenticating = true; state.error = null; state.notice = null;
    try { await loginClient.login(state.email, state.password); if (!isCurrent(requestGeneration, loginClient)) return; state.password = ""; state.signedIn = true; state.notice = "Signed in. Loading the customer ledger."; await refresh(); }
    catch (cause) { if (isCurrent(requestGeneration, loginClient)) { state.password = ""; state.signedIn = false; state.error = presentFramekitError(cause); } }
    finally { if (isCurrent(requestGeneration, loginClient)) state.authenticating = false; }
  }

  async function signOut() {
    const logoutClient = client;
    invalidateSession();
    const logoutGeneration = generation;
    state.error = null;
    state.notice = null;
    try {
      await logoutClient.logout();
      if (mounted && generation === logoutGeneration) state.notice = "Signed out. Your session was cleared from memory.";
    } catch (cause) {
      if (mounted && generation === logoutGeneration) state.error = presentFramekitError(cause);
    } finally {
      if (generation !== logoutGeneration) return;
      client = createFramekitClient();
      if (!mounted) return;
      state.signedIn = false;
      state.customers = [];
      state.meta = null;
      state.password = "";
      state.loading = false;
      state.submitting = false;
    }
  }

  async function createCustomer() {
    if (!state.name.trim()) { state.error = "A customer name is required before an entry can be posted."; return; }
    createController?.abort(); const controller = new AbortController(); createController = controller;
    const requestGeneration = generation; const requestClient = client; state.submitting = true; state.error = null; state.notice = null;
    try {
      const customer = await requestClient.create<CustomerData>("customer", { name: state.name.trim(), status: state.status, owner: state.owner.trim() || "Sales", annual_revenue: state.annualRevenue.trim() || "0.00" }, { idempotencyKey: crypto.randomUUID(), signal: controller.signal });
      if (!isCurrent(requestGeneration, requestClient) || controller.signal.aborted) return;
      state.customers = [customer, ...state.customers]; state.name = ""; state.status = "active"; state.owner = "Sales"; state.annualRevenue = "0.00"; state.notice = `Entry ${customer.id} posted to the ledger.`;
    } catch (cause) { if (isCurrent(requestGeneration, requestClient) && !controller.signal.aborted) state.error = presentFramekitError(cause); }
    finally { if (isCurrent(requestGeneration, requestClient) && createController === controller) { createController = null; state.submitting = false; } }
  }

  return {
    state,
    start() {
      mounted = true;
      void checkHealth();
    },
    destroy() {
      mounted = false;
      invalidateSession();
      client = createFramekitClient();
      state.customers = [];
      state.meta = null;
      state.loading = false;
      state.submitting = false;
      state.authenticating = false;
      state.signedIn = false;
      state.error = null;
      state.notice = null;
      state.password = "";
    },
    refresh,
    signIn,
    signOut,
    createCustomer
  };
}

export const ledger = createLedger();
