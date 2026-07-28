<script setup lang="ts">
import type { UnwrapNestedRefs } from "vue";
defineProps<{ credentials: UnwrapNestedRefs<{ email: string; password: string }>; authenticating: boolean; loading: boolean }>();
const emit = defineEmits<{ submit: [] }>();
</script>

<template>
  <section class="intake-panel entry entry-four" aria-labelledby="sign-in-title"><p class="eyebrow">02 / ACCESS SLIP</p><h2 id="sign-in-title">Sign in</h2>
    <form @submit.prevent="emit('submit')"><label><span>Email</span><input v-model.trim="credentials.email" type="email" required autocomplete="username" /></label>
      <label><span>Password</span><input v-model="credentials.password" type="password" required autocomplete="current-password" /></label>
      <button class="submit-button" type="submit" :disabled="authenticating || loading"><span>{{ authenticating ? "Opening…" : "Open ledger" }}</span><b aria-hidden="true">↗</b></button>
    </form><p class="idempotency-note">Session credentials remain only in this browser tab’s memory.</p>
  </section>
</template>
