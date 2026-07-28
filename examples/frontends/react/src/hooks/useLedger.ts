import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type FramekitClient, type HealthResponse } from "@framekit/sdk";
import { createClient } from "../api/framekit";
import { type Customer, type CustomerData, type CustomerForm, emptyCustomerForm, type LedgerMeta } from "../domain/customer";

export function useLedger() {
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
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);

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
        setForm(emptyCustomerForm);
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
      setForm(emptyCustomerForm);
      await loadLedger(client, generation);
    } catch (failure) {
      if (isCurrent(generation, client)) setError(failure);
    } finally {
      if (isCurrent(generation, client)) setCreating(false);
    }
  };

  return { customers, health, meta, healthLoading, loading, refreshing, signingIn, signedIn, creating, error, form, setForm, refresh, signIn, logout, submit };
}
