<script setup lang="ts">
import { baseUrl } from "./api/framekit";
import CustomerForm from "./components/CustomerForm.vue";
import CustomerList from "./components/CustomerList.vue";
import LedgerHeader from "./components/LedgerHeader.vue";
import LedgerSummary from "./components/LedgerSummary.vue";
import NoticeMessage from "./components/NoticeMessage.vue";
import SignInForm from "./components/SignInForm.vue";
import { useLedger } from "./composables/useLedger";

const {
  customers, health, loading, refreshing, submitting, authenticating, loggingOut, signedIn, error, successMessage,
  form, credentials, appName, appVersion, doctypeCount, loadLedger, signIn, signOut, createCustomer
} = useLedger();
</script>

<template>
  <main class="ledger-shell">
    <LedgerHeader :alive="health?.ok" :base-url="baseUrl" />
    <LedgerSummary :app-name="appName" :app-version="appVersion" :signed-in="signedIn" :doctype-count="doctypeCount" :customer-count="customers.length" />
    <NoticeMessage :error="error" :success-message="successMessage" />
    <div class="ledger-grid">
      <CustomerList :customers="customers" :loading="loading" :refreshing="refreshing" :signed-in="signedIn" @refresh="loadLedger" />
      <CustomerForm v-if="signedIn" :form="form" :submitting="submitting" :logging-out="loggingOut" @submit="createCustomer" @sign-out="signOut" />
      <SignInForm v-else :credentials="credentials" :authenticating="authenticating" :loading="loading" @submit="signIn" />
    </div>
    <footer class="footer-rule entry entry-four"><span>Framekit SDK v2</span><span>Default tenant / app context</span><span>No token persisted</span></footer>
  </main>
</template>
