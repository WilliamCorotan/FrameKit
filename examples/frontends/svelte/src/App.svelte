<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { framekitConfig } from "./lib/api/framekit";
  import CustomerRegister from "./lib/components/CustomerRegister.svelte";
  import EntryForm from "./lib/components/EntryForm.svelte";
  import LedgerHeader from "./lib/components/LedgerHeader.svelte";
  import Notices from "./lib/components/Notices.svelte";
  import { ledger } from "./lib/state/ledger.svelte";

  onMount(ledger.start);
  onDestroy(ledger.destroy);
</script>

<svelte:head><title>Customer Ledger · {framekitConfig.appName}</title></svelte:head>

<main class="ledger-shell">
  <LedgerHeader />
  <Notices />
  <div class="ledger-grid"><CustomerRegister /><EntryForm /></div>
  <footer><span>Framekit SDK v2</span><span>Customer doctype / direct API example</span></footer>
</main>
