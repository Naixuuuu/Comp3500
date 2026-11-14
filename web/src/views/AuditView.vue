<script setup>
import { ref, onMounted } from 'vue';
import { api, ApiError } from '../api.js';

const entries = ref([]);
const error = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.audit(200);
    entries.value = r.entries;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load the audit log';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function tone(action) {
  if (action.startsWith('vote.')) return 'vote';
  if (action.startsWith('login.')) return 'login';
  if (action.startsWith('results.') || action.startsWith('audit.')) return 'view';
  return '';
}
</script>

<template>
  <div class="card">
    <div class="head">
      <h2>Audit log</h2>
      <button @click="load" :disabled="loading">Refresh</button>
    </div>
    <p class="muted small intro">
      Append-only. There is no update or delete operation for this table anywhere in the
      service layer, which is what makes the record trustworthy.
    </p>

    <div v-if="error" class="alert error">{{ error }}</div>
    <p v-if="loading" class="muted">Loading…</p>

    <table v-if="entries.length">
      <thead>
        <tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.id">
          <td class="num muted">{{ e.id }}</td>
          <td class="when">{{ new Date(e.created_at).toLocaleString() }}</td>
          <td class="mono actor">{{ e.actor }}</td>
          <td><span class="action" :class="tone(e.action)">{{ e.action }}</span></td>
          <td class="muted small">{{ e.detail }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading" class="muted">No entries yet.</p>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
h2 { font-size: 18px; color: var(--navy); margin: 0; }
.intro { margin: 0 0 18px; line-height: 1.5; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line);
         vertical-align: top; }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; width: 48px; }
.when { white-space: nowrap; color: var(--muted); }
.actor { color: var(--navy); font-weight: 600; }
.action { font-family: Consolas, monospace; font-size: 12.5px; padding: 2px 7px;
          border-radius: 5px; background: #f2f4f8; color: #44506a; }
.action.vote { background: #e7f3e9; color: #1b5e20; }
.action.login { background: #eef3f9; color: var(--navy); }
.action.view { background: #fff6e5; color: var(--amber); }
</style>
