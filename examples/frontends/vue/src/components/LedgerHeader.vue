<script setup lang="ts">
defineProps<{ alive?: boolean; baseUrl: string }>();
</script>

<template>
  <header class="masthead entry entry-one">
    <div><p class="eyebrow">FRAMEKIT / CUSTOMER REGISTER</p><h1>Field<br /><em>ledger.</em></h1></div>
    <div class="masthead-note" aria-label="Connection details">
      <span class="status-dot" :class="{ alive }" aria-hidden="true"></span>
      <span>{{ alive ? "live connection" : "awaiting connection" }}</span>
      <code>{{ baseUrl || "same-origin API proxy" }}</code>
    </div>
  </header>
</template>
