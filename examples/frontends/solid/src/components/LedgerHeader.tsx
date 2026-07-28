import type { Accessor } from "solid-js";
import type { HealthResponse } from "@framekit/sdk";
import { framekitApp } from "../lib/api/framekit";

type LedgerHeaderProps = { health: Accessor<HealthResponse | undefined>; loading: Accessor<boolean> };

export function LedgerHeader(props: LedgerHeaderProps) {
  return <header class="masthead">
    <p class="eyebrow">Framekit / {framekitApp}</p>
    <h1>Customer<br /><em>ledger</em></h1>
    <div class="system-note" aria-live="polite">
      <span class={props.health()?.ok ? "status-dot online" : "status-dot"} />
      <span>{props.health()?.ok ? `${props.health()!.app} responding` : props.loading() ? "checking system" : "connection unknown"}</span>
    </div>
  </header>;
}
