import type { FormEvent } from "react";
import type { CustomerForm } from "../domain/customer";

type EntryFormProps = {
  creating: boolean;
  form: CustomerForm;
  signingIn: boolean;
  signedIn: boolean;
  onFormChange: (form: CustomerForm) => void;
  onSignIn: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function EntryForm({ creating, form, signingIn, signedIn, onFormChange, onSignIn, onSubmit }: EntryFormProps) {
  return <section className="entry-form enter delay-3" aria-labelledby="entry-title">
    <p className="eyebrow">folio 02 / {signedIn ? "new line" : "access"}</p><h2 id="entry-title">{signedIn ? "Enter a customer" : "Sign in"}</h2>
    {!signedIn ? <form key="sign-in" onSubmit={onSignIn}>
      <label>Email <input name="email" type="email" autoComplete="username" defaultValue="admin@example.com" required /></label>
      <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="submit-button" disabled={signingIn}>{signingIn ? "Signing in…" : "Open ledger"}</button>
    </form> : <form key="customer-entry" onSubmit={onSubmit}>
      <label>Name <input required value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} /></label>
      <div className="form-pair"><label>Status <select value={form.status} onChange={(event) => onFormChange({ ...form, status: event.target.value as CustomerForm["status"] })}><option value="active">Active</option><option value="paused">Paused</option></select></label>
        <label>Owner <input required value={form.owner} onChange={(event) => onFormChange({ ...form, owner: event.target.value })} /></label></div>
      <label>Annual revenue <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.annual_revenue} onChange={(event) => onFormChange({ ...form, annual_revenue: event.target.value })} /></label>
      <button className="submit-button" disabled={creating}>{creating ? "Entering…" : "Add to ledger"}</button>
    </form>}
  </section>;
}
