import type { Accessor } from "solid-js";
import type { CustomerFormValues } from "../domain/customer";

type CustomerEntryFormProps = {
  form: Accessor<CustomerFormValues>;
  submitting: Accessor<boolean>;
  setForm: (value: CustomerFormValues) => void;
  onSubmit: (event: SubmitEvent) => Promise<void>;
};

export function CustomerEntryForm(props: CustomerEntryFormProps) {
  const update = (field: keyof CustomerFormValues, value: string) => props.setForm({ ...props.form(), [field]: value });
  return <form class="new-entry" onSubmit={props.onSubmit}>
    <div class="section-heading"><span>01</span><h2>New entry</h2></div>
    <label>Name <input required value={props.form().name} onInput={(event) => update("name", event.currentTarget.value)} placeholder="Northstar Studio" /></label>
    <label>Status <select value={props.form().status} onChange={(event) => update("status", event.currentTarget.value)}><option value="active">Active</option><option value="paused">Paused</option></select></label>
    <label>Owner <input required value={props.form().owner} onInput={(event) => update("owner", event.currentTarget.value)} placeholder="Avery Chen" /></label>
    <label>Annual revenue <input required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={props.form().annual_revenue} onInput={(event) => update("annual_revenue", event.currentTarget.value)} /></label>
    <button class="submit-button" type="submit" disabled={props.submitting()}>{props.submitting() ? "Recording…" : "Record customer"}</button>
    <p class="form-note">Each submission includes a fresh idempotency key.</p>
  </form>;
}
