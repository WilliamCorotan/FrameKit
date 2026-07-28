import { apiUrl } from "../api/framekit";
import { describeError } from "../api/error";
import { type CustomerRecord, formatMoney } from "../domain/customer";
import { LedgerState } from "../state/ledger";
import { fieldLabel, inputField } from "./dom";

export function mountLedger(app: HTMLDivElement, ledger: LedgerState): () => void {
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
  const logoutButton = document.createElement("button");
  logoutButton.className = "refresh logout";
  logoutButton.type = "button";
  logoutButton.textContent = "Sign out";
  logoutButton.hidden = true;
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

  refreshButton.addEventListener("click", refreshRegister);
  logoutButton.addEventListener("click", () => void signOut());
  renderSignIn();
  void checkHealth();

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
    const result = formResult();
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
    const result = formResult();
    form.append(submit, result);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void createCustomer({ name, status, owner, revenue, submit, result, form });
    });
    entryPanel.append(heading, note, form);
  }

  async function checkHealth(): Promise<void> {
    statusLine.textContent = "Checking API…";
    const health = await ledger.checkHealth();
    if (!health) return;
    statusLine.textContent = health.available
      ? `${health.app} is live · sign in to open the register · ${health.apiUrl || "same-origin API proxy"}`
      : `API unavailable: ${describeError(health.error)}`;
  }

  async function signIn(email: HTMLInputElement, password: HTMLInputElement, submit: HTMLButtonElement, result: HTMLParagraphElement): Promise<void> {
    submit.disabled = true;
    result.textContent = "Signing in…";
    try {
      if (!await ledger.signIn(email.value, password.value)) return;
      refreshButton.disabled = false;
      logoutButton.hidden = false;
      renderCustomerForm();
      await loadRegister();
    } catch (error) {
      result.textContent = describeError(error);
    } finally {
      if (!ledger.isSignedIn()) submit.disabled = false;
    }
  }

  async function signOut(): Promise<void> {
    logoutButton.disabled = true;
    refreshButton.disabled = true;
    logoutButton.hidden = true;
    customerList.replaceChildren();
    listStatus.textContent = "Sign in to view customers.";
    renderSignIn("Signed out. No credentials were stored.");
    const signOutRequest = ledger.signOut();
    void checkHealth();
    const signOutError = await signOutRequest;
    if (signOutError) statusLine.textContent = `Sign-out request failed: ${describeError(signOutError)}`;
    if (!ledger.isSignedIn()) logoutButton.disabled = false;
  }

  async function loadRegister(): Promise<void> {
    if (!ledger.isSignedIn()) return;
    refreshButton.disabled = true;
    listStatus.textContent = "Reading the register…";
    customerList.replaceChildren();
    try {
      const register = await ledger.loadRegister();
      if (!register) return;
      statusLine.textContent = `Signed in · ${register.docTypeCount} schema records available · ${register.apiUrl || "same-origin API proxy"}`;
      renderCustomers(customerList, register.customers);
      listStatus.textContent = register.customers.length === 0
        ? "No customers yet. The first entry starts the register."
        : `${register.customers.length} customer${register.customers.length === 1 ? "" : "s"} shown.`;
    } catch (error) {
      listStatus.textContent = describeError(error);
    } finally {
      if (ledger.isSignedIn()) refreshButton.disabled = false;
    }
  }

  async function createCustomer(fields: { name: HTMLInputElement; status: HTMLSelectElement; owner: HTMLInputElement; revenue: HTMLInputElement; submit: HTMLButtonElement; result: HTMLParagraphElement; form: HTMLFormElement }): Promise<void> {
    if (!ledger.isSignedIn()) return;
    fields.submit.disabled = true;
    fields.result.textContent = "Adding customer…";
    try {
      const customer = await ledger.createCustomer({
        name: fields.name.value.trim(),
        status: fields.status.value as "active" | "paused",
        owner: fields.owner.value.trim(),
        annual_revenue: fields.revenue.value
      });
      if (!customer) return;
      fields.result.textContent = `${customer.data.name} added to the register.`;
      fields.form.reset();
      fields.owner.value = "Sales";
      fields.revenue.value = "0.00";
      await loadRegister();
    } catch (error) {
      fields.result.textContent = describeError(error);
    } finally {
      if (ledger.isSignedIn()) fields.submit.disabled = false;
    }
  }

  return () => {
    ledger.teardown();
    refreshButton.removeEventListener("click", refreshRegister);
  };

  function refreshRegister(): void {
    void loadRegister();
  }
}

function formResult(): HTMLParagraphElement {
  const result = document.createElement("p");
  result.className = "form-result";
  result.setAttribute("aria-live", "polite");
  return result;
}

function renderCustomers(customerList: HTMLOListElement, customers: CustomerRecord[]): void {
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
