<script setup>
import { ref, computed } from 'vue';
import { api, setToken, ApiError } from '../api.js';

const emit = defineEmits(['signed-in']);

const step = ref('credentials');   // credentials -> otp
const voterId = ref('');
const password = ref('');
const code = ref('');
const challengeId = ref('');
const devOtp = ref('');
const busy = ref(false);
const error = ref('');

async function submitCredentials() {
  error.value = '';
  busy.value = true;
  try {
    const r = await api.login(voterId.value.trim(), password.value);
    challengeId.value = r.challengeId;
    devOtp.value = r.devOtp || '';
    step.value = 'otp';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not reach the server';
  } finally {
    busy.value = false;
  }
}

async function submitOtp() {
  error.value = '';
  busy.value = true;
  try {
    const r = await api.verify(challengeId.value, code.value.trim());
    setToken(r.token);
    emit('signed-in', r.user);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not reach the server';
  } finally {
    busy.value = false;
  }
}

function back() {
  step.value = 'credentials';
  code.value = '';
  devOtp.value = '';
  error.value = '';
}

const canSubmitCredentials = computed(() => voterId.value.trim() && password.value);
const canSubmitOtp = computed(() => code.value.trim().length >= 4);
</script>

<template>
  <div class="login-wrap">
    <div class="card login-card">
      <div class="head">
        <h1>Election Management<br />and Voting System</h1>
        <p class="muted small">
          Sign in with your voter ID. A one-time password is required before any ballot can be cast.
        </p>
      </div>

      <div v-if="error" class="alert error">{{ error }}</div>

      <!-- step 1 -->
      <form v-if="step === 'credentials'" @submit.prevent="submitCredentials">
        <div class="field">
          <label for="vid">Voter ID</label>
          <input id="vid" v-model="voterId" autocomplete="username" placeholder="V1001" />
        </div>
        <div class="field">
          <label for="pwd">Password</label>
          <input id="pwd" v-model="password" type="password" autocomplete="current-password"
                 placeholder="password123" />
        </div>
        <button class="primary wide" :disabled="busy || !canSubmitCredentials">
          {{ busy ? 'Checking…' : 'Continue' }}
        </button>
        <p class="muted small demo">
          Demo accounts — voter <b>V1001</b>, officer <b>O2001</b>, admin <b>A3001</b>,
          auditor <b>U4001</b>. Password for all: <b>password123</b>.
        </p>
      </form>

      <!-- step 2 -->
      <form v-else @submit.prevent="submitOtp">
        <div class="alert info otp-hint">
          A six-digit one-time password was issued for <b>{{ voterId }}</b>.
          <span v-if="devOtp">In this demo it is <b class="mono">{{ devOtp }}</b> — a real
          deployment sends it through the OTP delivery service and never returns it here.</span>
        </div>
        <div class="field">
          <label for="otp">One-time password</label>
          <input id="otp" v-model="code" class="mono otp-input" inputmode="numeric"
                 maxlength="6" placeholder="000000" autocomplete="one-time-code" />
        </div>
        <div class="row">
          <button type="button" @click="back">Back</button>
          <button class="primary grow" :disabled="busy || !canSubmitOtp">
            {{ busy ? 'Verifying…' : 'Sign in' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card { width: 100%; max-width: 430px; }
.head h1 { font-size: 21px; color: var(--navy); margin: 0 0 8px; line-height: 1.3; }
.head { margin-bottom: 20px; }
.field { margin-bottom: 14px; }
.wide { width: 100%; margin-top: 4px; }
.row { display: flex; gap: 10px; }
.grow { flex: 1; }
.demo { margin: 16px 0 0; line-height: 1.5; }
.otp-hint { line-height: 1.5; }
.otp-input { letter-spacing: 6px; font-size: 20px; text-align: center; }
</style>
