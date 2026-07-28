<script setup lang="ts">
import type { FramekitSdkError } from "@framekit/sdk";
defineProps<{ error?: FramekitSdkError; successMessage: string }>();
</script>

<template>
  <section v-if="error" class="notice error entry" role="alert">
    <strong>{{ error.name }} · {{ error.code }}</strong><span>{{ error.message }}</span>
    <small v-if="error.status">HTTP {{ error.status }}</small><small v-if="error.requestId">request {{ error.requestId }}</small>
  </section>
  <section v-else-if="successMessage" class="notice success entry" role="status">{{ successMessage }}</section>
</template>
