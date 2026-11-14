<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api.js';
import { formatDateTime, describeRelative, phaseBadge } from '../datetime.js';

defineProps({ user: { type: Object, required: true } });
const emit = defineEmits(['voted', 'check-receipt']);

const elections = ref([]);
const selected = ref(null);     // ballot payload for the chosen election
const choice = ref(null);
const busy = ref(false);
const error = ref('');
const loading = ref(true);

const phase = computed(() => (selected.value ? phaseBadge(selected.value.windowPhase) : null));

function blockedReason() {
  const b = selected.value?.blockedBy;
  if (!b) return '';
  if (b === 'election_not_open') return 'This session is not open yet.';
  if (b === 'already_voted') return 'Your vote in this election has been recorded.';
  return selected.value.blockedMessage || 'Voting is not currently possible.';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.elections();
    elections.value = r.elections;
    const preferred = r.elections.find((e) => e.status === 'open') || r.elections[0];
    if (preferred) await open(preferred.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load elections';
  } finally {
    loading.value = false;
  }
}

async function open(id) {
  error.value = '';
  choice.value = null;
  try {
    selected.value = await api.ballot(id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load the ballot';
    selected.value = null;
  }
}

async function cast() {
  if (!choice.value) return;
  error.value = '';
  busy.value = true;
  try {
    const r = await api.vote(selected.value.election.id, choice.value.id);
    emit('voted', r);
    await open(selected.value.election.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not cast the ballot';
    await open(selected.value.election.id);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="card">
    <h2>Ballot</h2>

    <div v-if="error" class="alert error">{{ error }}</div>
    <p v-if="loading" class="muted">Loading…</p>

    <!-- ---------- election picker with its window ---------- -->
    <div v-if="elections.length" class="elections">
      <button v-for="e in elections" :key="e.id"
              :class="['chip', { active: selected && selected.election.id === e.id }]"
              @click="open(e.id)">
        <span class="chip-title">{{ e.title }}</span>
        <span class="tag" :class="e.status">{{ e.status }}</span>
        <span class="chip-window">
          {{ formatDateTime(e.opensAt) }} → {{ formatDateTime(e.closesAt) }}
        </span>
      </button>
    </div>

    <!-- ---------- the selected election ---------- -->
    <div v-if="selected" class="ballot">
      <div class="election-title">
        <h3>{{ selected.election.title }}</h3>
        <span class="tag" :class="selected.election.status">{{ selected.election.status }}</span>
        <span v-if="phase" class="tag" :class="phase.tone">{{ phase.text }}</span>
      </div>

      <!-- the window, stated plainly -->
      <div class="window">
        <div class="wrow">
          <span class="wlabel">Voting opens</span>
          <span class="wvalue">{{ formatDateTime(selected.election.opensAt) }}</span>
          <span class="wrel">{{ describeRelative(selected.election.opensAt) }}</span>
        </div>
        <div class="wrow">
          <span class="wlabel">Voting closes</span>
          <span class="wvalue">{{ formatDateTime(selected.election.closesAt) }}</span>
          <span class="wrel">{{ describeRelative(selected.election.closesAt) }}</span>
        </div>
      </div>

      <div v-if="!selected.canVote" class="alert"
           :class="selected.blockedBy === 'already_voted' ? 'ok' : 'info'">
        {{ blockedReason() }}
        <button v-if="selected.blockedBy === 'already_voted'" class="link"
                @click="emit('check-receipt')">Check a receipt →</button>
      </div>

      <div class="candidates">
        <label v-for="c in selected.candidates" :key="c.id"
               :class="['cand', { picked: choice && choice.id === c.id,
                                  disabled: !selected.canVote }]">
          <input type="radio" :value="c" v-model="choice"
                 :disabled="!selected.canVote" :name="'cand-' + selected.election.id" />
          <span class="cand-body">
            <span class="cand-name">{{ c.name }}</span>
            <span class="cand-party">{{ c.party }}</span>
          </span>
        </label>
      </div>

      <div class="actions">
        <button class="primary" :disabled="!selected.canVote || !choice || busy" @click="cast">
          {{ busy ? 'Recording…' : 'Cast ballot' }}
        </button>
        <span class="muted small">
          One candidate. Once accepted, the ballot cannot be changed or withdrawn.
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 { font-size: 18px; color: var(--navy); margin: 0 0 16px; }
.elections { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.chip { font-weight: 600; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        text-align: left; padding: 12px 16px; }
.chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.chip.active .tag { background: #ffffff33; color: #fff; }
.chip.active .chip-window { color: #cfdcec; }
.chip-title { flex: 1 1 auto; }
.chip-window { flex: 1 1 100%; font-size: 12px; font-weight: 500; color: var(--muted);
               font-variant-numeric: tabular-nums; }
.tag { font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
       padding: 2px 8px; border-radius: 99px; background: #eef3f9; color: var(--blue); }
.tag.open { background: #e7f3e9; color: #1b5e20; }
.tag.closed { background: #f2f2f2; color: #555; }
.tag.draft { background: #fff6e5; color: var(--amber); }
.election-title { display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
                  flex-wrap: wrap; }
.election-title h3 { font-size: 16px; margin: 0; color: var(--navy); }
.window { border: 1px solid var(--line); border-radius: 10px; background: #fbfcfe;
          padding: 12px 16px; margin-bottom: 16px; }
.wrow { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
        padding: 4px 0; font-size: 13.5px; }
.wlabel { color: var(--muted); text-transform: uppercase; font-size: 11px;
          letter-spacing: .4px; min-width: 92px; }
.wvalue { color: var(--navy); font-weight: 650; font-variant-numeric: tabular-nums; }
.wrel { color: var(--muted); font-size: 12px; }
.candidates { display: grid; gap: 10px; margin: 16px 0 20px; }
.cand { display: flex; gap: 12px; align-items: center; border: 1px solid var(--line);
        border-radius: 10px; padding: 13px 16px; cursor: pointer; background: #fff; }
.cand:hover:not(.disabled) { border-color: var(--blue); }
.cand.picked { border-color: var(--navy); background: #f4f7fb; }
.cand.disabled { opacity: .55; cursor: not-allowed; }
.cand input { width: auto; }
.cand-body { display: flex; flex-direction: column; }
.cand-name { font-weight: 650; color: var(--navy); }
.cand-party { font-size: 13px; color: var(--muted); }
.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.link { border: none; background: none; padding: 0 0 0 6px; color: var(--navy);
        text-decoration: underline; font-weight: 600; }
</style>
