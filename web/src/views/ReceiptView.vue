<script setup>
import { ref } from 'vue';
import { api, ApiError } from '../api.js';

const code = ref('');
const result = ref(null);
const busy = ref(false);
const error = ref('');

async function check() {
  if (!code.value.trim()) return;
  error.value = '';
  result.value = null;
  busy.value = true;
  try {
    result.value = await api.receipt(code.value.trim());
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not check the receipt';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card">
    <h2>Check a receipt</h2>
    <p class="muted small intro">
      A receipt confirms that a ballot was recorded. It deliberately does
      <b>not</b> show which candidate was chosen — otherwise it could be used to prove how
      someone voted.
    </p>

    <div v-if="error" class="alert error">{{ error }}</div>

    <form class="row" @submit.prevent="check">
      <input v-model="code" class="mono" placeholder="ABCDE-FGHJK" />
      <button class="primary" :disabled="busy || !code.trim()">
        {{ busy ? 'Checking…' : 'Check' }}
      </button>
    </form>

    <div v-if="result" class="result">
      <div v-if="result.recorded" class="alert ok">
        <b>Recorded.</b> Election: {{ result.electionTitle }}<br />
        <span class="small muted">Accepted at {{ new Date(result.castAt).toLocaleString() }}</span>
      </div>
      <div v-else class="alert error">
        No ballot carries that receipt code.
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 { font-size: 18px; color: var(--navy); margin: 0 0 8px; }
.intro { margin: 0 0 18px; line-height: 1.5; }
.row { display: flex; gap: 10px; }
.row input { flex: 1; letter-spacing: 2px; text-transform: uppercase; }
.result { margin-top: 18px; }
</style>
