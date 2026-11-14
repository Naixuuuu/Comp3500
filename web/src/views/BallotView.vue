<script setup>
import { ref, onMounted } from 'vue';
import { api, ApiError } from '../api.js';

const props = defineProps({ user: { type: Object, required: true } });
const emit = defineEmits(['voted', 'check-receipt']);

const elections = ref([]);
const selected = ref(null);     // ballot payload for the chosen election
const choice = ref(null);
const busy = ref(false);
const error = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.elections();
    elections.value = r.elections;
    const firstOpen = r.elections.find((e) => e.status === 'open') || r.elections[0];
    if (firstOpen) await open(firstOpen.id);
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

    <div v-if="elections.length" class="elections">
      <button v-for="e in elections" :key="e.id"
              :class="['chip', { active: selected && selected.election.id === e.id }]"
              @click="open(e.id)">
        {{ e.title }}
        <span class="tag" :class="e.status">{{ e.status }}</span>
      </button>
    </div>

    <div v-if="selected" class="ballot">
      <div class="election-title">
        <h3>{{ selected.election.title }}</h3>
        <span class="tag" :class="selected.election.status">{{ selected.election.status }}</span>
      </div>

      <div v-if="selected.hasVoted" class="alert ok">
        Your vote in this election has been recorded.
        <button class="link" @click="emit('check-receipt')">Check a receipt →</button>
      </div>
      <div v-else-if="selected.election.status !== 'open'" class="alert info">
        This election is {{ selected.election.status }}, so voting is closed.
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
.elections { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
.chip { font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.chip.active .tag { background: #ffffff33; color: #fff; }
.election-title { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.election-title h3 { font-size: 16px; margin: 0; color: var(--navy); }
.tag { font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
       padding: 2px 8px; border-radius: 99px; background: #eef3f9; color: var(--blue); }
.tag.open { background: #e7f3e9; color: #1b5e20; }
.tag.closed { background: #f2f2f2; color: #555; }
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
