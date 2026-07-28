<script lang="ts">
  import { ledger } from "../state/ledger.svelte";
  const { state } = ledger;
</script>

{#if state.error}
  <div class="message error" role="alert"><b>Request note</b><span>{state.error}</span></div>
{/if}
{#if state.notice}
  <div class="message success" role="status"><b>Posted</b><span>{state.notice}</span></div>
{/if}
