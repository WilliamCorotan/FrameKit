<script setup lang="ts">
import type { UnwrapNestedRefs } from "vue";
import type { CustomerFields } from "../domain/customer";
defineProps<{ form: UnwrapNestedRefs<CustomerFields>; submitting: boolean; loggingOut: boolean }>();
const emit = defineEmits<{ submit: []; signOut: [] }>();
</script>

<template>
  <section class="intake-panel entry entry-four" aria-labelledby="intake-title"><div class="intake-heading"><div><p class="eyebrow">02 / INTAKE SLIP</p><h2 id="intake-title">Enter a customer</h2></div>
    <button class="logout-button" type="button" :disabled="loggingOut" @click="emit('signOut')">{{ loggingOut ? "Leaving…" : "Sign out" }}</button></div>
    <form @submit.prevent="emit('submit')"><label><span>Name</span><input v-model.trim="form.name" required autocomplete="organization" placeholder="Northstar Goods" /></label>
      <div class="split-fields"><label><span>Status</span><select v-model="form.status"><option value="active">Active</option><option value="paused">Paused</option></select></label>
        <label><span>Owner</span><input v-model.trim="form.owner" required autocomplete="name" /></label></div>
      <label><span>Annual revenue</span><input v-model="form.annual_revenue" required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" aria-describedby="revenue-note" /><small id="revenue-note">Numbers only, in USD.</small></label>
      <button class="submit-button" type="submit" :disabled="submitting"><span>{{ submitting ? "Recording…" : "Record customer" }}</span><b aria-hidden="true">↗</b></button>
    </form><p class="idempotency-note">Each submission carries a fresh idempotency key.</p>
  </section>
</template>
