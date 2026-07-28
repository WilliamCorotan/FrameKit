<script lang="ts">
  import { formatMoney } from "../domain/customer";
  import { ledger } from "../state/ledger.svelte";
  const { state } = ledger;
</script>

<section class="register entry entry-three" aria-labelledby="register-title" aria-busy={state.loading}>
  <div class="section-title"><p class="kicker">01 / register</p><h2 id="register-title">Accounts on file <sup>{state.customers.length}</sup></h2></div>
  {#if !state.signedIn}
    <div class="empty-state"><span>↗</span><h3>Identity required.</h3><p>Health is public. The customer register opens after a bearer sign-in.</p></div>
  {:else if state.loading}
    <div class="loading-lines" aria-label="Loading customers"><i></i><i></i><i></i></div>
  {:else if state.customers.length === 0}
    <div class="empty-state"><span>∅</span><h3>The ledger is clear.</h3><p>Make the first customer entry at right.</p></div>
  {:else}
    <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Status</th><th>Owner</th><th>Annual revenue</th></tr></thead><tbody>
      {#each state.customers as customer (customer.id)}
        <tr><td><strong>{customer.data.name}</strong><small>{customer.id}</small></td><td><span class:paused={customer.data.status === "paused"} class="badge">{customer.data.status}</span></td><td>{customer.data.owner}</td><td class="revenue">{formatMoney(customer.data.annual_revenue)}</td></tr>
      {/each}
    </tbody></table></div>
  {/if}
</section>
