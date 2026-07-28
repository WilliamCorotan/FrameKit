import { For, Show, type Accessor } from "solid-js";
import { formatRevenue, type CustomerRecord } from "../domain/customer";

type CustomerTableProps = { customers: Accessor<CustomerRecord[]>; loading: Accessor<boolean> };

export function CustomerTable(props: CustomerTableProps) {
  return <section class="entries" aria-busy={props.loading()}>
    <div class="section-heading"><span>02</span><h2>Accounts on record</h2><span class="count">{props.customers().length}</span></div>
    <Show when={!props.loading()} fallback={<p class="state">Loading customer records…</p>}>
      <Show when={props.customers().length > 0} fallback={<p class="state">No customers yet. Make the first entry.</p>}>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead><tbody><For each={props.customers()}>{(customer) => <tr><td><strong>{customer.data.name || "Untitled"}</strong><small>{customer.id}</small></td><td><span class="pill">{customer.data.status || "—"}</span></td><td>{customer.data.owner || "—"}</td><td class="money">{formatRevenue(customer.data.annual_revenue)}</td></tr>}</For></tbody></table></div>
      </Show>
    </Show>
  </section>;
}
