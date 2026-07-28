<script lang="ts">
  import { ledger } from "../state/ledger.svelte";
  const { state, createCustomer, signIn } = ledger;

  function submitCustomer(event: SubmitEvent) { event.preventDefault(); void createCustomer(); }
  function submitSignIn(event: SubmitEvent) { event.preventDefault(); void signIn(); }
</script>

<aside class="entry-form entry entry-four" aria-labelledby="entry-title">
  {#if state.signedIn}
    <p class="kicker">02 / new entry</p><h2 id="entry-title">Add a customer</h2><p class="form-intro">Each post carries a fresh idempotency key, so a retry stays one entry.</p>
    <form onsubmit={submitCustomer}>
      <label>Name <input bind:value={state.name} autocomplete="organization" required placeholder="Acme Supply Co." /></label>
      <label>Status <select bind:value={state.status}><option value="active">Active</option><option value="paused">Paused</option></select></label>
      <label>Owner <input bind:value={state.owner} autocomplete="name" /></label>
      <label>Annual revenue <span class="input-affix">USD</span><input bind:value={state.annualRevenue} inputmode="decimal" placeholder="0.00" /></label>
      <button class="post" type="submit" disabled={state.submitting}>{state.submitting ? "Posting entry…" : "Post to ledger"} <span aria-hidden="true">→</span></button>
    </form>
  {:else}
    <p class="kicker">02 / access</p><h2 id="entry-title">Sign in</h2><p class="form-intro">Use a Framekit account to read and post customer records. Credentials stay in this form only.</p>
    <form onsubmit={submitSignIn}>
      <label>Email <input bind:value={state.email} type="email" autocomplete="username" required /></label>
      <label>Password <input bind:value={state.password} type="password" autocomplete="current-password" required /></label>
      <button class="post" type="submit" disabled={state.authenticating}>{state.authenticating ? "Signing in…" : "Open ledger"} <span aria-hidden="true">→</span></button>
    </form>
  {/if}
</aside>
