import { FramekitClient, FramekitSdkError } from "@framekit/sdk";
import "./styles.css";

type CustomerData = {
  name: string;
  status: "active" | "paused";
  owner: string;
  annual_revenue: string;
};
type CustomerRecord = { id: string; data: CustomerData };

const apiUrl = import.meta.env.VITE_FRAMEKIT_API_URL ?? "";
let client = makeClient();
let activeLoad: AbortController | undefined;
let signedIn = false;
let sessionGeneration = 0;

const app = requiredElement<HTMLDivElement>("app");
const page = document.createElement("main");
page.className = "ledger";
const header = document.createElement("header");
header.className = "masthead";
const eyebrow = document.createElement("p");
eyebrow.className = "eyebrow";
eyebrow.textContent = "FRAMEKIT / CUSTOMER REGISTER";
const title = document.createElement("h1");
title.textContent = "The working ledger.";
const subtitle = document.createElement("p");
subtitle.className = "subtitle";
subtitle.textContent = "A small, direct view into the customer record.";
const statusLine = document.createElement("p");
statusLine.className = "connection";
statusLine.setAttribute("aria-live", "polite");
const refreshButton = document.createElement("button");
refreshButton.className = "refresh";
refreshButton.type = "button";
refreshButton.textContent = "Refresh register";
refreshButton.disabled = true;
refreshButton.addEventListener("click", refreshRegister);
const logoutButton = document.createElement("button");
logoutButton.className = "refresh logout";
logoutButton.type = "button";
logoutButton.textContent = "Sign out";
logoutButton.hidden = true;
logoutButton.addEventListener("click", () => void signOut());
header.append(eyebrow, title, subtitle, statusLine, refreshButton, logoutButton);

const layout = document.createElement("div");
layout.className = "layout";
const entryPanel = document.createElement("section");
entryPanel.className = "entry";
const listPanel = document.createElement("section");
listPanel.className = "register";
const listTitle = document.createElement("h2");
listTitle.textContent = "Customers";
const listStatus = document.createElement("p");
listStatus.className = "list-status";
listStatus.setAttribute("aria-live", "polite");
const customerList = document.createElement("ol");
customerList.className = "customer-list";
listPanel.append(listTitle, listStatus, customerList);
layout.append(entryPanel, listPanel);
page.append(header, layout);
app.replaceChildren(page);

renderSignIn();
void checkHealth(sessionGeneration);
window.addEventListener("pagehide", teardown, { once: true });

function makeClient(): FramekitClient {
  return new FramekitClient({
    version: 2,
    baseUrl: apiUrl,
    authMode: "bearer",
    tenant: {
      tenantId: "default",
      userId: "vanilla-frontend",
      roles: ["administrator"],
      permissions: ["*"]
    }
  });
}

function renderSignIn(message?: string): void {
  entryPanel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Sign in";
  const note = document.createElement("p");
  note.textContent = "Your session stays in this page only.";
  const form = document.createElement("form");
  const email = inputField(form, "email", "Email", "email", true);
  email.autocomplete = "username";
  email.value = "admin@example.com";
  const password = inputField(form, "password", "Password", "password", true);
  password.autocomplete = "current-password";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Open register";
  const result = document.createElement("p");
  result.className = "form-result";
  result.setAttribute("aria-live", "polite");
  result.textContent = message ?? "";
  form.append(submit, result);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void signIn(email, password, submit, result);
  });
  entryPanel.append(heading, note, form);
}

function renderCustomerForm(): void {
  entryPanel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Enter a customer";
  const note = document.createElement("p");
  note.textContent = "Every submission carries an idempotency key.";
  const form = document.createElement("form");
  const name = inputField(form, "name", "Name", "text", true);
  const status = document.createElement("select");
  status.id = "status";
  for (const value of ["active", "paused"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    status.append(option);
  }
  form.append(fieldLabel("status", "Status", status));
  const owner = inputField(form, "owner", "Owner", "text", true);
  owner.value = "Sales";
  const revenue = inputField(form, "annual_revenue", "Annual revenue", "number", true);
  revenue.min = "0";
  revenue.step = "0.01";
  revenue.value = "0.00";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Add to ledger";
  const result = document.createElement("p");
  result.className = "form-result";
  result.setAttribute("aria-live", "polite");
  form.append(submit, result);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void createCustomer({ name, status, owner, revenue, submit, result, form });
  });
  entryPanel.append(heading, note, form);
}

async function checkHealth(generation: number): Promise<void> {
  statusLine.textContent = "Checking API…";
  try {
    const health = await client.health();
    if (!isCurrentGeneration(generation)) return;
    statusLine.textContent = `${health.app} is live · sign in to open the register · ${apiUrl || "same-origin API proxy"}`;
  } catch (error) {
    if (!isCurrentGeneration(generation)) return;
    statusLine.textContent = `API unavailable: ${describeError(error)}`;
  }
}

async function signIn(email: HTMLInputElement, password: HTMLInputElement, submit: HTMLButtonElement, result: HTMLParagraphElement): Promise<void> {
  const generation = sessionGeneration;
  const loginClient = client;
  submit.disabled = true;
  result.textContent = "Signing in…";
  try {
    await loginClient.login(email.value.trim(), password.value);
    if (!isCurrentGeneration(generation) || client !== loginClient) return;
    signedIn = true;
    sessionGeneration += 1;
    refreshButton.disabled = false;
    logoutButton.hidden = false;
    renderCustomerForm();
    await loadRegister();
  } catch (error) {
    if (isCurrentGeneration(generation) && client === loginClient) result.textContent = describeError(error);
  } finally {
    if (isCurrentGeneration(generation) && client === loginClient) submit.disabled = false;
  }
}

async function signOut(): Promise<void> {
  const previousClient = client;
  const generation = invalidateSession();
  logoutButton.disabled = true;
  refreshButton.disabled = true;
  logoutButton.hidden = true;
  customerList.replaceChildren();
  listStatus.textContent = "Sign in to view customers.";
  renderSignIn("Signed out. No credentials were stored.");
  void checkHealth(generation);
  try {
    await previousClient.logout();
  } catch (error) {
    if (isCurrentGeneration(generation)) statusLine.textContent = `Sign-out request failed: ${describeError(error)}`;
  } finally {
    if (isCurrentGeneration(generation)) logoutButton.disabled = false;
  }
}

async function loadRegister(): Promise<void> {
  if (!signedIn) return;
  const generation = sessionGeneration;
  const loadClient = client;
  activeLoad?.abort();
  const controller = new AbortController();
  activeLoad = controller;
  refreshButton.disabled = true;
  listStatus.textContent = "Reading the register…";
  customerList.replaceChildren();
  try {
    const [metadata, customers] = await Promise.all([
      loadClient.meta({}),
      loadClient.listPage<CustomerData>("customer", { limit: 50, signal: controller.signal })
    ]);
    if (!isCurrentSession(generation, loadClient)) return;
    const docTypes = metadataDocTypeCount(metadata);
    statusLine.textContent = `Signed in · ${docTypes} schema records available · ${apiUrl || "same-origin API proxy"}`;
    renderCustomers(customers.items);
    listStatus.textContent = customers.items.length === 0 ? "No customers yet. The first entry starts the register." : `${customers.items.length} customer${customers.items.length === 1 ? "" : "s"} shown.`;
  } catch (error) {
    if (controller.signal.aborted || !isCurrentSession(generation, loadClient)) return;
    listStatus.textContent = describeError(error);
  } finally {
    if (activeLoad === controller && isCurrentSession(generation, loadClient)) refreshButton.disabled = false;
  }
}

async function createCustomer(fields: { name: HTMLInputElement; status: HTMLSelectElement; owner: HTMLInputElement; revenue: HTMLInputElement; submit: HTMLButtonElement; result: HTMLParagraphElement; form: HTMLFormElement }): Promise<void> {
  if (!signedIn) return;
  const generation = sessionGeneration;
  const createClient = client;
  fields.submit.disabled = true;
  fields.result.textContent = "Adding customer…";
  try {
    const customer = await createClient.create<CustomerData>("customer", {
      name: fields.name.value.trim(),
      status: fields.status.value as CustomerData["status"],
      owner: fields.owner.value.trim(),
      annual_revenue: fields.revenue.value
    }, { idempotencyKey: crypto.randomUUID() });
    if (!isCurrentSession(generation, createClient)) return;
    fields.result.textContent = `${customer.data.name} added to the register.`;
    fields.form.reset();
    fields.owner.value = "Sales";
    fields.revenue.value = "0.00";
    await loadRegister();
  } catch (error) {
    if (isCurrentSession(generation, createClient)) fields.result.textContent = describeError(error);
  } finally {
    if (isCurrentSession(generation, createClient)) fields.submit.disabled = false;
  }
}

function renderCustomers(customers: CustomerRecord[]): void {
  const fragment = document.createDocumentFragment();
  for (const customer of customers) {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = customer.data.name;
    const detail = document.createElement("span");
    detail.textContent = `${customer.data.status} · ${customer.data.owner} · ${formatMoney(customer.data.annual_revenue)}`;
    row.append(name, detail);
    fragment.append(row);
  }
  customerList.replaceChildren(fragment);
}

function inputField(form: HTMLFormElement, id: string, label: string, type: string, required: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.name = id;
  input.type = type;
  input.required = required;
  form.append(fieldLabel(id, label, input));
  return input;
}

function fieldLabel(forId: string, text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.htmlFor = forId;
  const caption = document.createElement("span");
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

function metadataDocTypeCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const modules = (metadata as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) return 0;
  return modules.reduce((count, module) => {
    if (!module || typeof module !== "object") return count;
    const doctypes = (module as { doctypes?: unknown }).doctypes;
    return count + (Array.isArray(doctypes) ? doctypes.length : 0);
  }, 0);
}

function describeError(error: unknown): string {
  if (error instanceof FramekitSdkError) {
    const request = error.requestId ? ` Request: ${error.requestId}.` : "";
    return `${error.code}${error.status ? ` (${error.status})` : ""}: ${error.message}.${request}`;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function formatMoney(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount) : value;
}

function requiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof Element)) throw new Error(`Missing #${id}.`);
  return element as unknown as T;
}

function invalidateSession(): number {
  sessionGeneration += 1;
  activeLoad?.abort();
  activeLoad = undefined;
  signedIn = false;
  client = makeClient();
  return sessionGeneration;
}

function isCurrentGeneration(generation: number): boolean {
  return sessionGeneration === generation;
}

function isCurrentSession(generation: number, requestClient: FramekitClient): boolean {
  return signedIn && isCurrentGeneration(generation) && client === requestClient;
}

function teardown(): void {
  invalidateSession();
  refreshButton.removeEventListener("click", refreshRegister);
}

function refreshRegister(): void {
  void loadRegister();
}
