<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api.js';

const emit = defineEmits(['changed']);

const elections = ref([]);
const detail = ref(null);
const title = ref('');
const candName = ref('');
const candParty = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const loading = ref(true);

const status = computed(() => detail.value?.election?.status);
const canEditCandidates = computed(() => status.value === 'draft');
const canOpen = computed(() => status.value === 'draft' && detail.value.candidates.length > 0);
const canClose = computed(() => status.value === 'open');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.elections();
    elections.value = r.elections;
    if (!detail.value && r.elections.length) await select(r.elections[r.elections.length - 1].id);
    else if (detail.value) await select(detail.value.election.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not load elections';
  } finally {
    loading.value = false;
  }
}

async function select(id) {
  error.value = '';
  try {
    detail.value = await api.adminElection(id);
  } catch (e) {
    detail.value = null;
    error.value = e instanceof ApiError ? e.message : 'Could not load the election';
  }
}

function flash(msg) {
  notice.value = msg;
  setTimeout(() => { notice.value = ''; }, 4000);
}

async function run(fn, okMessage) {
  error.value = '';
  busy.value = true;
  try {
    await fn();
    if (okMessage) flash(okMessage);
    await load();
    emit('changed');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'The request failed';
  } finally {
    busy.value = false;
  }
}

async function createElection() {
  if (!title.value.trim()) return;
  const t = title.value.trim();
  await run(async () => {
    const r = await api.createElection(t);
    title.value = '';
    detail.value = r;
  }, `Created “${t}” as a draft. Add candidates next.`);
}

async function addCandidate() {
  if (!candName.value.trim() || !candParty.value.trim()) return;
  const id = detail.value.election.id;
  const n = candName.value.trim();
  await run(async () => {
    detail.value = await api.addCandidate(id, n, candParty.value.trim());
    candName.value = '';
    candParty.value = '';
  }, `Added ${n}.`);
}

const openIt = () => run(() => api.openElection(detail.value.election.id),
  'Session opened — voters can now cast a ballot.');
const closeIt = () => run(() => api.closeElection(detail.value.election.id),
  'Session closed — the result is now publishable.');

onMounted(load);
</script>

<template>
  <div class="card">
    <h2>Administration</h2>
    <p class="muted small intro">
      Create an election, add its candidates, then open the session. Nothing can be voted on
      until the session is open, and candidates are frozen once it is.
    </p>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="notice" class="alert ok">{{ notice }}</div>
    <p v-if="loading" class="muted">Loading…</p>

    <!-- new election -->
    <form class="newline" @submit.prevent="createElection">
      <input v-model="title" placeholder="New election title, e.g. By-Election 2027" />
      <button class="primary" :disabled="busy || !title.trim()">Create election</button>
    </form>

    <!-- picker -->
    <div v-if="elections.length" class="elections">
      <button v-for="e in elections" :key="e.id"
              :class="['chip', { active: detail && detail.election.id === e.id }]"
              @click="select(e.id)">
        {{ e.title }}
        <span class="tag" :class="e.status">{{ e.status }}</span>
      </button>
    </div>

    <div v-if="detail" class="detail">
      <div class="head">
        <h3>{{ detail.election.title }}</h3>
        <span class="tag" :class="detail.election.status">{{ detail.election.status }}</span>
      </div>

      <div class="stats">
        <div class="stat"><span class="n">{{ detail.candidates.length }}</span>
          <span class="l">candidates</span></div>
        <div class="stat"><span class="n">{{ detail.votersOnRoll }}</span>
          <span class="l">voters on roll</span></div>
        <div class="stat"><span class="n">{{ detail.votersMarkedAsVoted }}</span>
          <span class="l">marked as voted</span></div>
        <div class="stat"><span class="n">{{ detail.totalBallots }}</span>
          <span class="l">ballots</span></div>
      </div>

      <!-- candidates -->
      <table v-if="detail.candidates.length">
        <thead><tr><th>Candidate</th><th>Party</th></tr></thead>
        <tbody>
          <tr v-for="c in detail.candidates" :key="c.id">
            <td class="name">{{ c.name }}</td><td class="muted">{{ c.party }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted small none">No candidates yet — the session cannot be opened.</p>

      <form v-if="canEditCandidates" class="row" @submit.prevent="addCandidate">
        <input v-model="candName" placeholder="Candidate name" />
        <input v-model="candParty" placeholder="Party / affiliation" />
        <button :disabled="busy || !candName.trim() || !candParty.trim()">Add</button>
      </form>
      <p v-else class="muted small lock">
        Candidates are locked because the session is {{ detail.election.status }}.
      </p>

      <!-- session control -->
      <div class="actions">
        <button v-if="status === 'draft'" class="primary"
                :disabled="busy || !canOpen" @click="openIt">
          Open voting session
        </button>
        <button v-else-if="status === 'open'" class="primary" :disabled="busy" @click="closeIt">
          Close voting session
        </button>
        <button v-else disabled>Session closed</button>

        <span class="muted small hint">
          <template v-if="status === 'draft'">
            Draft → Open is the only way forward. At least one candidate is required.
          </template>
          <template v-else-if="status === 'open'">
            Closing publishes the count. There is no transition back to open.
          </template>
          <template v-else>
            A closed election can never accept another ballot — the state machine has no edge
            out of it.
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 { font-size: 18px; color: var(--navy); margin: 0 0 8px; }
.intro { margin: 0 0 18px; line-height: 1.5; }
.newline { display: flex; gap: 10px; margin-bottom: 18px; }
.newline input { flex: 1; }
.newline button { white-space: nowrap; }
.elections { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
.chip { font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.chip.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.chip.active .tag { background: #ffffff33; color: #fff; }
.tag { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 99px;
       background: #eef3f9; color: var(--blue); }
.tag.draft { background: #fff6e5; color: var(--amber); }
.tag.open { background: #e7f3e9; color: #1b5e20; }
.tag.closed { background: #f2f2f2; color: #555; }
.detail { border-top: 1px solid var(--line); padding-top: 18px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.head h3 { font-size: 16px; margin: 0; color: var(--navy); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
         gap: 12px; margin-bottom: 18px; }
.stat { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
        display: flex; flex-direction: column; }
.stat .n { font-size: 20px; font-weight: 700; color: var(--navy); }
.stat .l { font-size: 12.5px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 14px; }
th, td { text-align: left; padding: 9px 11px; border-bottom: 1px solid var(--line); }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); }
td.name { font-weight: 650; color: var(--navy); }
.row { display: flex; gap: 10px; margin-bottom: 10px; }
.row input { flex: 1; }
.none, .lock { margin: 0 0 14px; }
.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
           border-top: 1px solid var(--line); padding-top: 16px; }
.hint { flex: 1; min-width: 220px; line-height: 1.45; }
</style>
