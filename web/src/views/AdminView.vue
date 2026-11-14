<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api.js';
import {
  toLocalInput, fromLocalInput, defaultWindow, formatWindow, describeRelative, phaseBadge,
} from '../datetime.js';

const emit = defineEmits(['changed']);

const elections = ref([]);
const detail = ref(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');

// --- create form
const newTitle = ref('');
const createWindow = ref(defaultWindow());

// --- edit form (election)
const editing = ref(false);
const editTitle = ref('');
const editWindow = ref({ opensAt: '', closesAt: '' });

// --- add candidate form
const candName = ref('');
const candParty = ref('');

// --- per-candidate inline edit
const editingCandidate = ref(null);   // candidate id
const candEditName = ref('');
const candEditParty = ref('');

const status = computed(() => detail.value?.election?.status);
const isClosed = computed(() => status.value === 'closed');
const canEditCandidates = computed(() => status.value === 'draft');
const canOpen = computed(() => status.value === 'draft' && detail.value.candidates.length > 0);
const canClose = computed(() => status.value === 'open');
const windowLabel = computed(() => {
  const e = detail.value?.election;
  return e ? `${formatWindow(e.opensAt, e.closesAt)}` : '';
});

function flash(msg) { notice.value = msg; setTimeout(() => { notice.value = ''; }, 5000); }

function fail(e) {
  error.value = e instanceof ApiError ? e.message : 'The request failed';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.elections();
    elections.value = r.elections;
    if (detail.value) {
      const still = r.elections.find((x) => x.id === detail.value.election.id);
      if (still) { await select(still.id); return; }
      detail.value = null;
    }
    if (r.elections.length) await select(r.elections[r.elections.length - 1].id);
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}

async function select(id) {
  error.value = '';
  editing.value = false;
  editingCandidate.value = null;
  try {
    detail.value = await api.adminElection(id);
  } catch (e) {
    detail.value = null;
    fail(e);
  }
}

/** Run a mutation, then refresh the list and the open detail. */
async function act(label, fn) {
  error.value = '';
  busy.value = true;
  try {
    const r = await fn();
    if (r && r.election) detail.value = r;      // service returns the fresh detail
    await load();
    emit('changed');
    if (label) flash(label);
    return true;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    busy.value = false;
  }
}

async function createElection() {
  if (!newTitle.value.trim()) return;
  const title = newTitle.value.trim();
  const opensAt = fromLocalInput(createWindow.value.opensAt);
  const closesAt = fromLocalInput(createWindow.value.closesAt);
  const ok = await act(null, async () => {
    const r = await api.createElection(title, opensAt, closesAt);
    newTitle.value = '';
    createWindow.value = defaultWindow();
    return r;
  });
  if (ok) flash(`Created “${title}” as a draft. Add candidates next.`);
}

function startEdit() {
  editTitle.value = detail.value.election.title;
  editWindow.value = {
    opensAt: toLocalInput(detail.value.election.opensAt),
    closesAt: toLocalInput(detail.value.election.closesAt),
  };
  editing.value = true;
  error.value = '';
}

async function saveEdit() {
  const ok = await act('Election updated.', () => api.updateElection(detail.value.election.id, {
    title: editTitle.value.trim(),
    opensAt: fromLocalInput(editWindow.value.opensAt),
    closesAt: fromLocalInput(editWindow.value.closesAt),
  }));
  if (ok) editing.value = false;
}

async function removeElection() {
  const e = detail.value.election;
  if (!window.confirm(`Delete “${e.title}” permanently?\n\nIts candidates and voter roll go with it. This cannot be undone.`)) return;
  const ok = await act(null, async () => {
    await api.deleteElection(e.id);
    detail.value = null;
    return null;
  });
  if (ok) flash('Election deleted.');
}

async function addCandidate() {
  if (!candName.value.trim() || !candParty.value.trim()) return;
  const name = candName.value.trim();
  const ok = await act(`Added ${name}.`, async () => {
    const r = await api.addCandidate(detail.value.election.id, name, candParty.value.trim());
    candName.value = '';
    candParty.value = '';
    return r;
  });
  if (!ok) return;
}

function startCandidateEdit(c) {
  editingCandidate.value = c.id;
  candEditName.value = c.name;
  candEditParty.value = c.party;
  error.value = '';
}

async function saveCandidateEdit(c) {
  await act('Candidate updated.', () => api.updateCandidate(c.id, {
    name: candEditName.value.trim(),
    party: candEditParty.value.trim(),
  }));
  editingCandidate.value = null;
}

async function removeCandidate(c) {
  if (!window.confirm(`Remove ${c.name} from this ballot?`)) return;
  await act(`${c.name} removed.`, () => api.deleteCandidate(c.id));
}

const openIt = () => act('Session opened — voters can now cast a ballot.',
  () => api.openElection(detail.value.election.id));
const closeIt = () => act('Session closed — the result is now publishable.',
  () => api.closeElection(detail.value.election.id));

onMounted(load);
</script>

<template>
  <div class="card">
    <h2>Administration</h2>
    <p class="muted small intro">
      Create an election with its voting window, add candidates, then open the session.
      A ballot is accepted only while the session is open <em>and</em> the clock is inside the
      window. Everything here can be edited until the session is closed.
    </p>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="notice" class="alert ok">{{ notice }}</div>
    <p v-if="loading" class="muted">Loading…</p>

    <!-- ---------- create ---------- -->
    <form class="create" @submit.prevent="createElection">
      <input v-model="newTitle" placeholder="New election title, e.g. By-Election 2027" />
      <div class="window-row">
        <label class="dt">
          <span>Opens</span>
          <input type="datetime-local" v-model="createWindow.opensAt" />
        </label>
        <label class="dt">
          <span>Closes</span>
          <input type="datetime-local" v-model="createWindow.closesAt" />
        </label>
        <button class="primary" :disabled="busy || !newTitle.trim()">Create election</button>
      </div>
    </form>

    <!-- ---------- picker ---------- -->
    <div v-if="elections.length" class="elections">
      <button v-for="e in elections" :key="e.id"
              :class="['chip', { active: detail && detail.election.id === e.id }]"
              @click="select(e.id)">
        {{ e.title }}
        <span class="tag" :class="e.status">{{ e.status }}</span>
      </button>
    </div>

    <!-- ---------- detail ---------- -->
    <div v-if="detail" class="detail">
      <!-- view mode -->
      <div v-if="!editing" class="head">
        <h3>{{ detail.election.title }}</h3>
        <span class="tag" :class="detail.election.status">{{ detail.election.status }}</span>
        <div class="head-actions">
          <button class="mini" :disabled="busy || isClosed" @click="startEdit">
            {{ isClosed ? 'Closed — locked' : 'Edit' }}
          </button>
          <button class="mini danger" :disabled="busy" @click="removeElection">Delete</button>
        </div>
      </div>

      <!-- edit mode -->
      <form v-else class="edit-form" @submit.prevent="saveEdit">
        <label class="dt wide">
          <span>Title</span>
          <input v-model="editTitle" />
        </label>
        <div class="window-row">
          <label class="dt">
            <span>Opens</span>
            <input type="datetime-local" v-model="editWindow.opensAt" />
          </label>
          <label class="dt">
            <span>Closes</span>
            <input type="datetime-local" v-model="editWindow.closesAt" />
          </label>
        </div>
        <div class="row">
          <button class="primary" :disabled="busy || !editTitle.trim()">Save changes</button>
          <button type="button" @click="editing = false">Cancel</button>
        </div>
      </form>

      <p class="window-line">
        <span class="wlabel">Voting window</span>
        <span class="wvalue">{{ windowLabel }}</span>
      </p>

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

      <!-- ---------- candidates ---------- -->
      <table v-if="detail.candidates.length">
        <thead>
          <tr><th>Candidate</th><th>Party</th><th class="right">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in detail.candidates" :key="c.id">
            <template v-if="editingCandidate === c.id">
              <td><input v-model="candEditName" class="inline" /></td>
              <td><input v-model="candEditParty" class="inline" /></td>
              <td class="right nowrap">
                <button class="mini primary" :disabled="busy" @click="saveCandidateEdit(c)">Save</button>
                <button class="mini" @click="editingCandidate = null">Cancel</button>
              </td>
            </template>
            <template v-else>
              <td class="name">{{ c.name }}</td>
              <td class="muted">{{ c.party }}</td>
              <td class="right nowrap">
                <button class="mini" :disabled="busy || !canEditCandidates"
                        @click="startCandidateEdit(c)">Edit</button>
                <button class="mini danger" :disabled="busy || !canEditCandidates"
                        @click="removeCandidate(c)">Remove</button>
              </td>
            </template>
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

      <!-- ---------- session control ---------- -->
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
            Closing publishes the count. There is no transition back to open. The window
            closes {{ describeRelative(detail.election.closesAt) }}.
          </template>
          <template v-else>
            A closed election can never accept another ballot, and it can no longer be edited.
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 { font-size: 18px; color: var(--navy); margin: 0 0 8px; }
.intro { margin: 0 0 18px; line-height: 1.5; }
.create { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
.create > input { width: 100%; }
.window-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.dt { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 170px; }
.dt span { font-size: 12px; font-weight: 600; color: var(--navy); }
.dt input { width: 100%; }
.dt.wide { flex: 1 1 100%; }
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
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.head h3 { font-size: 16px; margin: 0; color: var(--navy); }
.head-actions { margin-left: auto; display: flex; gap: 8px; }
.edit-form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;
             border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: #fbfcfe; }
.window-line { margin: 0 0 16px; font-size: 13.5px; display: flex; gap: 10px; flex-wrap: wrap; }
.wlabel { color: var(--muted); text-transform: uppercase; font-size: 11.5px;
          letter-spacing: .4px; padding-top: 2px; }
.wvalue { color: var(--navy); font-weight: 600; font-variant-numeric: tabular-nums; }
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
.right { text-align: right; }
.nowrap { white-space: nowrap; }
input.inline { padding: 5px 8px; font-size: 13.5px; }
.row { display: flex; gap: 10px; margin-bottom: 10px; }
.row input { flex: 1; }
.none, .lock { margin: 0 0 14px; }
.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
           border-top: 1px solid var(--line); padding-top: 16px; }
.hint { flex: 1; min-width: 220px; line-height: 1.45; }
.mini { padding: 5px 11px; font-size: 12.5px; border-radius: 6px; }
.mini.danger { border-color: #e0a9a4; color: var(--red); }
.mini.danger:hover:not(:disabled) { background: #fdecea; }
em { font-style: normal; background: #fff3cd; padding: 0 2px; border-radius: 2px; }
</style>
