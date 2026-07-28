import { Show } from "solid-js";
import { CustomerEntryForm } from "./components/CustomerEntryForm";
import { CustomerTable } from "./components/CustomerTable";
import { LedgerHeader } from "./components/LedgerHeader";
import { NoticeBoundary } from "./components/NoticeBoundary";
import { SignInForm } from "./components/SignInForm";
import { useLedger } from "./state/useLedger";

export function App() {
  const ledger = useLedger();

  return <main class="ledger-shell">
    <LedgerHeader health={ledger.health} loading={ledger.loading} />
    <section class="intro" aria-label="Ledger overview">
      <p>New accounts, kept in plain sight. Live data from the Framekit API—not a stored session.</p>
      <Show when={ledger.authenticated()} fallback={<span class="signin-prompt">Sign in to open the ledger</span>}>
        <div class="actions"><button class="text-button" type="button" onClick={ledger.load} disabled={ledger.loading()}>{ledger.loading() ? "Refreshing…" : "Refresh ledger"}</button><button class="text-button" type="button" onClick={ledger.signOut}>Sign out</button></div>
      </Show>
    </section>
    <NoticeBoundary error={ledger.error} success={ledger.success} />
    <Show when={ledger.authenticated()} fallback={<SignInForm email={ledger.email} password={ledger.password} signingIn={ledger.signingIn} setEmail={ledger.setEmail} setPassword={ledger.setPassword} onSubmit={ledger.signIn} />}>
      <section class="ledger-grid">
        <CustomerEntryForm form={ledger.form} submitting={ledger.submitting} setForm={ledger.setForm} onSubmit={ledger.createCustomer} />
        <CustomerTable customers={ledger.customers} loading={ledger.loading} />
      </section>
    </Show>
    <footer><span>Metadata {ledger.metadata() ? "loaded" : "pending"}</span><span>v2 client · default tenant</span></footer>
  </main>;
}
