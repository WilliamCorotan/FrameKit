import type { Customer } from "../domain/customer";
import { formatRevenue } from "../domain/customer";
import { ErrorNotice } from "./ErrorNotice";

type CustomerTableProps = {
  customers: Customer[];
  detail?: string;
  loading: boolean;
  refreshing: boolean;
  signedIn: boolean;
  onRefresh: () => void;
  onLogout: () => Promise<void>;
};

export function CustomerTable({ customers, detail, loading, refreshing, signedIn, onRefresh, onLogout }: CustomerTableProps) {
  return <section className="records enter delay-2" aria-labelledby="records-title">
    <div className="section-heading">
      <div><p className="eyebrow">folio 01</p><h2 id="records-title">Customer register</h2></div>
      {signedIn && <div className="action-pair"><button className="text-button" onClick={onRefresh} disabled={loading || refreshing}>
        {refreshing ? "Refreshing…" : "Refresh list"}
      </button><button className="text-button" onClick={() => void onLogout()}>Sign out</button></div>}
    </div>

    {detail && <ErrorNotice detail={detail} />}
    {!signedIn && <p className="state-message">Sign in to read and add customer records. Your session remains only in this browser tab’s memory.</p>}
    {signedIn && loading && <p className="state-message" role="status">Opening the register…</p>}
    {signedIn && !loading && !detail && customers.length === 0 && <p className="state-message">No customers entered yet. The first line is waiting.</p>}
    {signedIn && !loading && !detail && customers.length > 0 && <div className="table-wrap">
      <table><thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead>
        <tbody>{customers.map((customer) => <tr key={customer.id}>
          <td><strong>{customer.data.name ?? "Untitled"}</strong><small>{customer.id}</small></td>
          <td><span className={`status ${customer.data.status === "active" ? "active" : "paused"}`}>{customer.data.status ?? "—"}</span></td>
          <td>{customer.data.owner ?? "—"}</td><td>{formatRevenue(customer.data.annual_revenue)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
