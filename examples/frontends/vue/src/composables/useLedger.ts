import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { FramekitSdkError, type HealthResponse } from "@framekit/sdk";
import { createFramekitClient } from "../api/framekit";
import { createCustomerFields, type CustomerFields, type CustomerRecord, type MetaSummary } from "../domain/customer";

export function useLedger() {
  const customers = ref<CustomerRecord[]>([]);
  const health = ref<HealthResponse>();
  const metadata = ref<MetaSummary>();
  const loading = ref(true);
  const refreshing = ref(false);
  const submitting = ref(false);
  const authenticating = ref(false);
  const loggingOut = ref(false);
  const signedIn = ref(false);
  const error = ref<FramekitSdkError>();
  const successMessage = ref("");
  const form = reactive<CustomerFields>(createCustomerFields());
  const credentials = reactive({ email: "admin@example.com", password: "" });
  let framekit = createFramekitClient();
  let mounted = true;
  let sessionGeneration = 0;
  let sessionController = new AbortController();
  let healthController = new AbortController();

  const appName = computed(() => metadata.value?.name ?? health.value?.app ?? "Framekit");
  const appVersion = computed(() => metadata.value?.version);
  const doctypeCount = computed(() => metadata.value?.modules?.flatMap((module) => module.doctypes ?? []).length ?? 0);
  const hasCustomers = computed(() => customers.value.length > 0);

  onMounted(() => void loadHealth());
  onUnmounted(() => {
    mounted = false;
    healthController.abort();
    invalidateSession();
  });

  async function loadHealth() {
    const controller = healthController;
    error.value = undefined;
    loading.value = true;
    try {
      const nextHealth = await framekit.health({ signal: controller.signal });
      if (!isHealthCurrent(controller)) return;
      health.value = nextHealth;
    } catch (caught) {
      if (!isHealthCurrent(controller)) return;
      error.value = asSdkError(caught);
    } finally {
      if (isHealthCurrent(controller)) loading.value = false;
    }
  }

  async function loadLedger(generation = sessionGeneration) {
    if (!isSessionCurrent(generation)) return;
    const controller = sessionController;
    error.value = undefined;
    successMessage.value = "";
    refreshing.value = true;
    try {
      const [nextMetadata, page] = await Promise.all([
        framekit.meta<MetaSummary>(),
        framekit.listPage<CustomerFields>("customer", { limit: 50, sort: { field: "name", direction: "asc" }, signal: controller.signal })
      ]);
      if (!isSessionCurrent(generation, controller)) return;
      metadata.value = nextMetadata;
      customers.value = page.items;
    } catch (caught) {
      if (!isSessionCurrent(generation, controller)) return;
      error.value = asSdkError(caught);
    } finally {
      if (isSessionCurrent(generation, controller)) refreshing.value = false;
    }
  }

  async function signIn() {
    const generation = beginSession();
    error.value = undefined;
    successMessage.value = "";
    authenticating.value = true;
    try {
      await framekit.login(credentials.email, credentials.password);
      if (!isGenerationCurrent(generation)) return;
      credentials.password = "";
      signedIn.value = true;
      await loadLedger(generation);
    } catch (caught) {
      if (isGenerationCurrent(generation)) error.value = asSdkError(caught);
    } finally {
      if (isGenerationCurrent(generation)) authenticating.value = false;
    }
  }

  async function signOut() {
    const generation = invalidateSession();
    const client = framekit;
    error.value = undefined;
    loggingOut.value = true;
    try {
      await client.logout();
    } catch (caught) {
      if (isGenerationCurrent(generation)) error.value = asSdkError(caught);
    } finally {
      if (!isGenerationCurrent(generation)) return;
      framekit = createFramekitClient();
      signedIn.value = false;
      metadata.value = undefined;
      customers.value = [];
      successMessage.value = "";
      credentials.password = "";
      loggingOut.value = false;
    }
  }

  async function createCustomer() {
    const generation = sessionGeneration;
    if (!isSessionCurrent(generation)) return;
    const controller = sessionController;
    error.value = undefined;
    successMessage.value = "";
    submitting.value = true;
    try {
      const created = await framekit.create<CustomerFields>("customer", { ...form }, { idempotencyKey: `customer-${crypto.randomUUID()}`, signal: controller.signal });
      if (!isSessionCurrent(generation, controller)) return;
      customers.value = [created, ...customers.value];
      successMessage.value = `${created.data.name} entered in the ledger.`;
      Object.assign(form, createCustomerFields());
    } catch (caught) {
      if (isSessionCurrent(generation, controller)) error.value = asSdkError(caught);
    } finally {
      if (isSessionCurrent(generation, controller)) submitting.value = false;
    }
  }

  function beginSession() {
    invalidateSession();
    framekit = createFramekitClient();
    return sessionGeneration;
  }
  function invalidateSession() {
    sessionGeneration += 1;
    sessionController.abort();
    sessionController = new AbortController();
    return sessionGeneration;
  }
  function isHealthCurrent(controller: AbortController) {
    return mounted && controller === healthController && !controller.signal.aborted;
  }
  function isSessionCurrent(generation: number, controller = sessionController) {
    return mounted && signedIn.value && generation === sessionGeneration && controller === sessionController && !controller.signal.aborted;
  }
  function isGenerationCurrent(generation: number) {
    return mounted && generation === sessionGeneration && !sessionController.signal.aborted;
  }
  function asSdkError(caught: unknown): FramekitSdkError {
    if (caught instanceof FramekitSdkError) return caught;
    return new FramekitSdkError(caught instanceof Error ? caught.message : "An unexpected request error occurred.", "UNKNOWN_ERROR", undefined, undefined, undefined, undefined, { cause: caught });
  }

  return { customers, health, loading, refreshing, submitting, authenticating, loggingOut, signedIn, error, successMessage, form, credentials, appName, appVersion, doctypeCount, hasCustomers, loadLedger, signIn, signOut, createCustomer };
}
