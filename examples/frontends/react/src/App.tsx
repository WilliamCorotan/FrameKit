import { CustomerTable } from "./components/CustomerTable";
import { EntryForm } from "./components/EntryForm";
import { Header } from "./components/Header";
import { MarginNote } from "./components/MarginNote";
import { describeError } from "./api/error";
import { useLedger } from "./hooks/useLedger";

export function App() {
  const ledger = useLedger();
  const detail = describeError(ledger.error);

  return <main className="ledger-shell">
    <Header health={ledger.health} healthLoading={ledger.healthLoading} meta={ledger.meta} />
    <section className="ledger-grid">
      <MarginNote meta={ledger.meta} />
      <CustomerTable
        customers={ledger.customers}
        detail={detail}
        loading={ledger.loading}
        refreshing={ledger.refreshing}
        signedIn={ledger.signedIn}
        onRefresh={ledger.refresh}
        onLogout={ledger.logout}
      />
      <EntryForm
        creating={ledger.creating}
        form={ledger.form}
        signingIn={ledger.signingIn}
        signedIn={ledger.signedIn}
        onFormChange={ledger.setForm}
        onSignIn={ledger.signIn}
        onSubmit={ledger.submit}
      />
    </section>
  </main>;
}
