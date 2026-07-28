<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { FramekitSdkError, type HealthResponse } from "@framekit/sdk";
import { baseUrl, createFramekitClient } from "./framekit";

type CustomerFields = {
  name: string;
  status: "active" | "paused";
  owner: string;
  annual_revenue: string;
};

type CustomerRecord = { id: string; data: CustomerFields };
type MetaSummary = { name?: string; version?: string; modules?: Array<{ doctypes?: unknown[] }> };

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
const form = reactive<CustomerFields>({ name: "", status: "active", owner: "Sales", annual_revenue: "0.00" });
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
    if (!isHealthCurrent(controller)) return;
    loading.value = false;
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
    if (!isSessionCurrent(generation, controller)) return;
    refreshing.value = false;
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
    if (!isGenerationCurrent(generation)) return;
    error.value = asSdkError(caught);
  } finally {
    if (!isGenerationCurrent(generation)) return;
    authenticating.value = false;
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
    if (!isGenerationCurrent(generation)) return;
    error.value = asSdkError(caught);
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
    const created = await framekit.create<CustomerFields>("customer", { ...form }, { idempotencyKey: createIdempotencyKey(), signal: controller.signal });
    if (!isSessionCurrent(generation, controller)) return;
    customers.value = [created, ...customers.value];
    successMessage.value = `${created.data.name} entered in the ledger.`;
    form.name = "";
    form.status = "active";
    form.owner = "Sales";
    form.annual_revenue = "0.00";
  } catch (caught) {
    if (!isSessionCurrent(generation, controller)) return;
    error.value = asSdkError(caught);
  } finally {
    if (!isSessionCurrent(generation, controller)) return;
    submitting.value = false;
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
  return new FramekitSdkError(
    caught instanceof Error ? caught.message : "An unexpected request error occurred.",
    "UNKNOWN_ERROR",
    undefined,
    undefined,
    undefined,
    undefined,
    { cause: caught }
  );
}

function createIdempotencyKey() {
  return `customer-${crypto.randomUUID()}`;
}

function currency(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
    : value;
}
</script>

<template>
  <main class="ledger-shell">
    <header class="masthead entry entry-one">
      <div>
        <p class="eyebrow">FRAMEKIT / CUSTOMER REGISTER</p>
        <h1>Field<br /><em>ledger.</em></h1>
      </div>
      <div class="masthead-note" aria-label="Connection details">
        <span class="status-dot" :class="{ alive: health?.ok }" aria-hidden="true"></span>
        <span>{{ health?.ok ? "live connection" : "awaiting connection" }}</span>
        <code>{{ baseUrl || "same-origin API proxy" }}</code>
      </div>
    </header>

    <section class="rule entry entry-two" aria-label="Ledger summary">
      <p>{{ appName }} <span v-if="appVersion">· v{{ appVersion }}</span></p>
      <p v-if="signedIn">{{ doctypeCount }} document types / {{ customers.length }} customers in view</p>
      <p v-else>Sign in to open protected records</p>
    </section>

    <section v-if="error" class="notice error entry" role="alert">
      <strong>{{ error.name }} · {{ error.code }}</strong>
      <span>{{ error.message }}</span>
      <small v-if="error.status">HTTP {{ error.status }}</small>
      <small v-if="error.requestId">request {{ error.requestId }}</small>
    </section>
    <section v-else-if="successMessage" class="notice success entry" role="status">{{ successMessage }}</section>

    <div class="ledger-grid">
      <section class="customer-panel entry entry-three" aria-labelledby="customer-list-title" :aria-busy="loading || refreshing">
        <div class="section-heading">
          <div>
            <p class="eyebrow">01 / CURRENT ACCOUNTS</p>
            <h2 id="customer-list-title">Customers</h2>
          </div>
          <button v-if="signedIn" class="text-button" type="button" :disabled="refreshing" @click="() => loadLedger()">
            {{ refreshing ? "Refreshing…" : "Refresh list" }}
          </button>
        </div>

        <div v-if="loading" class="state-card" role="status">Checking the line…</div>
        <div v-else-if="!signedIn" class="state-card empty">
          <span>Ledger sealed.</span>
          <p>Use the sign-in slip to open customer records.</p>
        </div>
        <div v-else-if="!hasCustomers" class="state-card empty">
          <span>Nothing recorded.</span>
          <p>Add the first customer using the intake card.</p>
        </div>
        <ol v-else class="customer-list">
          <li v-for="customer in customers" :key="customer.id">
            <div class="customer-name">
              <strong>{{ customer.data.name }}</strong>
              <span>{{ customer.data.owner }}</span>
            </div>
            <span class="badge" :class="customer.data.status">{{ customer.data.status }}</span>
            <span class="revenue">{{ currency(customer.data.annual_revenue) }}</span>
          </li>
        </ol>
      </section>

      <section v-if="signedIn" class="intake-panel entry entry-four" aria-labelledby="intake-title">
        <div class="intake-heading">
          <div>
            <p class="eyebrow">02 / INTAKE SLIP</p>
            <h2 id="intake-title">Enter a customer</h2>
          </div>
          <button class="logout-button" type="button" :disabled="loggingOut" @click="signOut">{{ loggingOut ? "Leaving…" : "Sign out" }}</button>
        </div>
        <form @submit.prevent="createCustomer">
          <label>
            <span>Name</span>
            <input v-model.trim="form.name" required autocomplete="organization" placeholder="Northstar Goods" />
          </label>
          <div class="split-fields">
            <label>
              <span>Status</span>
              <select v-model="form.status">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
            <label>
              <span>Owner</span>
              <input v-model.trim="form.owner" required autocomplete="name" />
            </label>
          </div>
          <label>
            <span>Annual revenue</span>
            <input v-model="form.annual_revenue" required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" aria-describedby="revenue-note" />
            <small id="revenue-note">Numbers only, in USD.</small>
          </label>
          <button class="submit-button" type="submit" :disabled="submitting">
            <span>{{ submitting ? "Recording…" : "Record customer" }}</span>
            <b aria-hidden="true">↗</b>
          </button>
        </form>
        <p class="idempotency-note">Each submission carries a fresh idempotency key.</p>
      </section>
      <section v-else class="intake-panel entry entry-four" aria-labelledby="sign-in-title">
        <p class="eyebrow">02 / ACCESS SLIP</p>
        <h2 id="sign-in-title">Sign in</h2>
        <form @submit.prevent="signIn">
          <label>
            <span>Email</span>
            <input v-model.trim="credentials.email" type="email" required autocomplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input v-model="credentials.password" type="password" required autocomplete="current-password" />
          </label>
          <button class="submit-button" type="submit" :disabled="authenticating || loading">
            <span>{{ authenticating ? "Opening…" : "Open ledger" }}</span>
            <b aria-hidden="true">↗</b>
          </button>
        </form>
        <p class="idempotency-note">Session credentials remain only in this browser tab’s memory.</p>
      </section>
    </div>

    <footer class="footer-rule entry entry-four">
      <span>Framekit SDK v2</span><span>Default tenant / app context</span><span>No token persisted</span>
    </footer>
  </main>
</template>
