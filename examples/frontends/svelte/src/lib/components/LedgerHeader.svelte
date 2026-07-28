<script lang="ts">
  import { framekitConfig } from "../api/framekit";
  import { ledger } from "../state/ledger.svelte";

  const { state, refresh, signOut } = ledger;
</script>

<header class="masthead entry entry-one">
  <p class="kicker"><span class="signal" aria-hidden="true"></span> Framekit / {framekitConfig.appName}</p>
  <div class="masthead-row">
    <h1>Customer<br /><em>ledger.</em></h1>
    <div class="terminal" aria-label="Connection details">
      <span class:online={state.health === "online"} class:offline={state.health === "offline"} class="status-dot"></span>
      <span>{state.health === "checking" ? "checking node" : state.health === "online" ? "node live" : "node unavailable"}</span>
      <small>{framekitConfig.apiUrl || "same-origin API proxy"}</small>
    </div>
  </div>
</header>

<section class="context entry entry-two" aria-label="Ledger context">
  <p>Tenant <strong>{framekitConfig.tenantId}</strong> / operator <strong>{framekitConfig.userId}</strong></p>
  <p>{state.meta?.app?.name ?? state.meta?.name ?? framekitConfig.appName}{state.meta?.app?.version ?? state.meta?.version ? ` · ${state.meta.app?.version ?? state.meta.version}` : ""}</p>
  {#if state.signedIn}
    <div class="context-actions">
      <button class="refresh" onclick={refresh} disabled={state.loading} aria-label="Refresh customer ledger"><span aria-hidden="true">↻</span> {state.loading ? "Refreshing" : "Refresh"}</button>
      <button class="refresh" onclick={() => void signOut()} aria-label="Sign out">Sign out</button>
    </div>
  {:else}
    <span class="auth-prompt">Sign in to open ledger</span>
  {/if}
</section>
