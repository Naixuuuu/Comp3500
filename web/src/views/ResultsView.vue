<script setup>
import { ref, onMounted } from 'vue';
import { api, ApiError } from '../api.js';

const elections = ref([]);
const current = ref(null);
const error = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const r = await api.elections();
    elections.value = r.elections;
    const closed = r.elections.find((e) => e.status === 'closed') || r.elections[0];
    if (closed) await show(closed.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load results';
  } finally {
    loading.value = false;
  }
}

async function show(id) {
  error.value = '';
  try {
    current.value = await api.results(id);
  } catch (e) {
    current.value = null;
    error.value = e instanceof ApiError ? e.message : 'Could not load results';
  }
}

onMounted(load);
</script>

<template>
  <div class="card">
    <h2>Results</h2>

    <div v-if="error" class="alert error">{{ error }}</div>
    <p v-if="loading" class="muted">Loading…</p>

    <div v-if="elections.length" class="elections">
      <button v-for="e in elections" :key="e.id"
              :class="['chip', { active: current && current.election.id === e.id }]"
              @click="show(e.id)">
        {{ e.title }}
        <span class="tag" :class="e.status">{{ e.status }}</span>
      </button>
    </div>

    <div v-if="current">
      <div class="stats">
        <div class="stat">
          <span class="n">{{ current.totalBallots }}</span>
          <span class="l">ballots accepted</span>
        </div>
        <div class="stat">
          <span class="n">{{ current.votersMarkedAsVoted }}</span>
          <span class="l">voters marked as voted</span>
        </div>
        <div class="stat">
          <span class="n">{{ current.turnoutPercent }}%</span>
          <span class="l">turnout of {{ current.votersOnRoll }} on roll</span>
        </div>
        <div class="stat" :class="{ good: current.invariantHolds, bad: !current.invariantHolds }">
          <span class="n">{{ current.invariantHolds ? 'OK' : 'BROKEN' }}</span>
          <span class="l">D2: ballots ≤ voters marked</span>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Candidate</th><th>Party</th><th class="num">Votes</th><th class="num">Share</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in current.results" :key="r.candidateId">
            <td class="name">{{ r.name }}</td>
            <td class="muted">{{ r.party }}</td>
            <td class="num">{{ r.votes }}</td>
            <td class="num">{{ r.share }}%</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total counted</td>
            <td class="num">{{ current.totalVotesCounted }}</td>
            <td class="num">100%</td>
          </tr>
        </tfoot>
      </table>

      <p v-if="current.decryptFailures" class="alert error">
        {{ current.decryptFailures }} ballot(s) failed the authentication check and were not
        counted. This is what tamper detection looks like.
      </p>
      <p class="muted small">
        The tally decrypts each ballot inside the service layer; only the per-candidate totals
        leave it. No individual ballot is exposed by this view.
      </p>
    </div>
  </div>
</template>

<style scoped>
h2 { font-size: 18px; color: var(--navy); margin: 0 0 16px; }
.elections { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
.chip { font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.tag { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 99px;
       background: #eef3f9; color: var(--blue); }
.chip.active .tag { background: #ffffff33; color: #fff; }
.tag.open { background: #e7f3e9; color: #1b5e20; }
.tag.closed { background: #f2f2f2; color: #555; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
         gap: 12px; margin-bottom: 20px; }
.stat { border: 1px solid var(--line); border-radius: 10px; padding: 13px 15px;
        display: flex; flex-direction: column; background: #fff; }
.stat .n { font-size: 22px; font-weight: 700; color: var(--navy); }
.stat .l { font-size: 12.5px; color: var(--muted); }
.stat.good { border-color: #b7ddbc; background: #f4faf5; }
.stat.good .n { color: var(--green); }
.stat.bad { border-color: #f0b7b3; background: #fdf3f2; }
.stat.bad .n { color: var(--red); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); }
td.name { font-weight: 650; color: var(--navy); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; color: var(--navy); background: #f7f9fc; }
</style>
