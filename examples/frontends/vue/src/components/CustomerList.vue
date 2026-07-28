<script setup lang="ts">
import { currency, type CustomerRecord } from "../domain/customer";
defineProps<{ customers: CustomerRecord[]; loading: boolean; refreshing: boolean; signedIn: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
</script>

<template>
  <section class="customer-panel entry entry-three" aria-labelledby="customer-list-title" :aria-busy="loading || refreshing">
    <div class="section-heading"><div><p class="eyebrow">01 / CURRENT ACCOUNTS</p><h2 id="customer-list-title">Customers</h2></div>
      <button v-if="signedIn" class="text-button" type="button" :disabled="refreshing" @click="emit('refresh')">{{ refreshing ? "Refreshing…" : "Refresh list" }}</button>
    </div>
    <div v-if="loading" class="state-card" role="status">Checking the line…</div>
    <div v-else-if="!signedIn" class="state-card empty"><span>Ledger sealed.</span><p>Use the sign-in slip to open customer records.</p></div>
    <div v-else-if="!customers.length" class="state-card empty"><span>Nothing recorded.</span><p>Add the first customer using the intake card.</p></div>
    <ol v-else class="customer-list"><li v-for="customer in customers" :key="customer.id">
      <div class="customer-name"><strong>{{ customer.data.name }}</strong><span>{{ customer.data.owner }}</span></div>
      <span class="badge" :class="customer.data.status">{{ customer.data.status }}</span><span class="revenue">{{ currency(customer.data.annual_revenue) }}</span>
    </li></ol>
  </section>
</template>
