import { apiUrl } from "../api/framekit";
import type { LedgerMeta } from "../domain/customer";
import type { HealthResponse } from "@framekit/sdk";

type HeaderProps = { health?: HealthResponse; healthLoading: boolean; meta?: LedgerMeta };

export function Header({ health, healthLoading, meta }: HeaderProps) {
  const appName = meta?.name ?? health?.app ?? "Framekit";

  return <header className="masthead enter">
    <p className="eyebrow">{appName} / customer registry</p>
    <div className="masthead-row">
      <h1>Field<br /><em>Ledger</em></h1>
      <div className="system-stamp" aria-label={health ? "API health: online" : "API health: checking"}>
        <span className={health ? "pulse online" : "pulse"} />
        <span>{health ? "live / verified" : healthLoading ? "live / checking" : "live / unavailable"}</span>
        <small>{apiUrl || "same-origin API proxy"}</small>
      </div>
    </div>
  </header>;
}
