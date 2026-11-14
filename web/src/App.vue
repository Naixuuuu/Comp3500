<script setup>
import { ref, computed } from 'vue';
import { api, setToken } from './api.js';
import LoginView from './views/LoginView.vue';
import BallotView from './views/BallotView.vue';
import ReceiptView from './views/ReceiptView.vue';
import ResultsView from './views/ResultsView.vue';
import AuditView from './views/AuditView.vue';
import AdminView from './views/AdminView.vue';

const user = ref(null);
const view = ref('vote');
const flash = ref(null);   // { kind, text }
const ballotKey = ref(0);  // bumped to force the ballot view to reload after an admin change

const isPrivileged = computed(
  () => user.value && (user.value.role === 'auditor' || user.value.role === 'admin')
);
const isAdmin = computed(() => user.value && user.value.role === 'admin');

const tabs = computed(() => {
  if (!user.value) return [];
  const t = [{ id: 'vote', label: 'Ballot' }, { id: 'receipt', label: 'Receipt' }];
  if (isPrivileged.value) t.push({ id: 'results', label: 'Results' });
  if (isAdmin.value) t.push({ id: 'admin', label: 'Admin' });
  t.push({ id: 'audit', label: 'Audit log' });
  return t;
});

async function onSignedIn(u) {
  user.value = u;
  view.value = 'vote';
  flash.value = null;
}

async function signOut() {
  try { await api.logout(); } catch { /* the token may already be gone */ }
  setToken(null);
  user.value = null;
  view.value = 'vote';
  flash.value = null;
}

function onVoted(result) {
  flash.value = { kind: 'ok', text: result.receiptCode };
  view.value = 'receipt';
}

function goReceipt() {
  view.value = 'receipt';
}

function dismiss() { flash.value = null; }
</script>

<template>
  <LoginView v-if="!user" @signed-in="onSignedIn" />

  <div v-else class="shell">
    <header class="bar">
      <div class="brand">
        <span class="dot"></span>
        <span>Election Management and Voting System</span>
      </div>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.id"
                :class="['tab', { active: view === t.id }]"
                @click="view = t.id">{{ t.label }}</button>
      </nav>
      <div class="who">
        <span class="name">{{ user.name }}</span>
        <span class="role">{{ user.role }}</span>
        <button class="ghost" @click="signOut">Sign out</button>
      </div>
    </header>

    <main class="content">
      <div v-if="flash" class="alert ok receipt-flash">
        <div>
          <b>Ballot accepted.</b> Your receipt code is
          <span class="mono code">{{ flash.text }}</span> — keep it. It proves a ballot was
          recorded, and it does not reveal your choice.
        </div>
        <button class="ghost" @click="dismiss">Dismiss</button>
      </div>

      <BallotView v-if="view === 'vote'" :key="ballotKey" :user="user"
                  @voted="onVoted" @check-receipt="goReceipt" />
      <ReceiptView v-else-if="view === 'receipt'" />
      <ResultsView v-else-if="view === 'results'" />
      <AdminView v-else-if="view === 'admin'" @changed="ballotKey++" />
      <AuditView v-else-if="view === 'audit'" />
    </main>

    <footer class="foot">
      COMP 3500SEF · Election Management and Voting System · ballots are encrypted at rest and
      the single-vote rule is enforced inside one database transaction
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.bar { background: var(--navy); color: #fff; padding: 0 22px; display: flex;
       align-items: center; gap: 22px; flex-wrap: wrap; min-height: 58px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 14px;
         letter-spacing: .2px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #7fb2ea; display: inline-block; }
.tabs { display: flex; gap: 4px; }
.tab { background: transparent; border: none; color: #cddcee; padding: 7px 13px;
       border-radius: 7px; font-weight: 600; font-size: 14px; }
.tab:hover { background: #ffffff1a; color: #fff; }
.tab.active { background: #ffffff26; color: #fff; }
.who { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.who .name { font-weight: 650; }
.who .role { text-transform: uppercase; font-size: 11px; letter-spacing: .6px;
             background: #ffffff26; padding: 2px 8px; border-radius: 99px; }
.ghost { background: transparent; border: 1px solid #ffffff55; color: #fff;
         padding: 6px 12px; font-size: 13px; }
.ghost:hover { background: #ffffff1f; }
.content { flex: 1; width: 100%; max-width: 880px; margin: 26px auto; padding: 0 22px; }
.receipt-flash { display: flex; align-items: flex-start; gap: 16px; justify-content: space-between; }
.receipt-flash .code { font-size: 16px; font-weight: 700; letter-spacing: 1px; }
.foot { text-align: center; font-size: 12px; color: var(--muted); padding: 18px 22px 26px; }
</style>
