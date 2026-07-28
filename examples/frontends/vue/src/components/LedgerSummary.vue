<script setup lang="ts">
defineProps<{ appName: string; appVersion?: string; signedIn: boolean; doctypeCount: number; customerCount: number }>();
</script>

<template>
  <section class="rule entry entry-two" aria-label="Ledger summary">
    <p>{{ appName }} <span v-if="appVersion">· v{{ appVersion }}</span></p>
    <p v-if="signedIn">{{ doctypeCount }} document types / {{ customerCount }} customers in view</p>
    <p v-else>Sign in to open protected records</p>
  </section>
</template>
