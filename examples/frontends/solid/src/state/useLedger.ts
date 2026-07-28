import { createSignal, onCleanup, onMount } from "solid-js";
import { FramekitSdkError, type HealthResponse } from "@framekit/sdk";
import { type Customer, type CustomerFormValues, type CustomerRecord, initialCustomerForm } from "../domain/customer";
import { clearClientSession, client } from "../lib/api/framekit";

type RequestGuard = { generation: number; controller: AbortController };

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

export function useLedger() {
  const [customers, setCustomers] = createSignal<CustomerRecord[]>([]);
  const [health, setHealth] = createSignal<HealthResponse>();
  const [metadata, setMetadata] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(true);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [signingIn, setSigningIn] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [success, setSuccess] = createSignal<string>();
  const [form, setForm] = createSignal<CustomerFormValues>(initialCustomerForm());
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

  const checkHealth = async (): Promise<void> => {
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

  const load = async (): Promise<void> => {
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

  const signIn = async (event: SubmitEvent): Promise<void> => {
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

  const signOut = async (): Promise<void> => {
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
    }
  };

  const createCustomer = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const request = beginRequest();
    setSubmitting(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const customer = await client.create<Customer>("customer", form(), { idempotencyKey: idempotencyKey(), signal: request.controller.signal });
      if (isCurrent(request)) {
        setCustomers((current) => [customer, ...current]);
        setForm(initialCustomerForm());
        setSuccess(`${customer.data.name || "Customer"} added to the ledger.`);
      }
    } catch (cause) {
      if (isCurrent(request)) setError(messageFor(cause));
    } finally {
      if (isCurrent(request)) setSubmitting(false);
      finishRequest(request);
    }
  };

  onMount(() => void checkHealth());
  onCleanup(() => {
    mounted = false;
    invalidateSession();
  });

  return { customers, health, metadata, loading, authenticated, signingIn, submitting, error, success, form, email, password, setForm, setEmail, setPassword, load, signIn, signOut, createCustomer };
}
