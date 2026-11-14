/**
 * Tests for the administration paths added in the second increment:
 * creating an election, adding candidates, and opening/closing the session.
 *
 * Identifiers T16..T21 continue the sequence in docs/04-testing.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, seedIfEmpty, getDb } from '../src/db.js';
import { createApp } from '../src/index.js';

let server;
let base;

before(async () => {
  openDb(':memory:');
  seedIfEmpty();
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  closeDb();
});

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}

async function signIn(voterId, password = 'password123') {
  const a = await call('POST', '/api/auth/login', { voterId, password });
  assert.equal(a.status, 200, `login failed for ${voterId}`);
  const b = await call('POST', '/api/auth/verify', {
    challengeId: a.body.challengeId, code: a.body.devOtp,
  });
  assert.equal(b.status, 200, `verify failed for ${voterId}`);
  return b.body.token;
}

// ------------------------------------------------------------------ T16
test('T16  an administrator creates a draft election and it appears in the list', async () => {
  const token = await signIn('A3001');
  const r = await call('POST', '/api/admin/elections', { title: 'By-Election 2026' }, token);
  assert.equal(r.status, 201);
  assert.equal(r.body.election.status, 'draft');
  assert.equal(r.body.candidates.length, 0);
  assert.ok(r.body.votersOnRoll >= 6, 'every registered user should be enrolled on the roll');

  const list = await call('GET', '/api/elections', undefined, token);
  const found = list.body.elections.find((e) => e.title === 'By-Election 2026');
  assert.ok(found, 'the new election must be visible in the election list');
  assert.equal(found.status, 'draft');
});

// ------------------------------------------------------------------ T17
test('T17  a voter cannot create an election', async () => {
  const token = await signIn('V1001');
  const r = await call('POST', '/api/admin/elections', { title: 'Rogue Election' }, token);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden_role');

  const officer = await signIn('O2001');
  const r2 = await call('POST', '/api/admin/elections', { title: 'Rogue Election' }, officer);
  assert.equal(r2.status, 403, 'the presiding officer is not an administrator either');
});

// ------------------------------------------------------------------ T18
test('T18  a draft election cannot be voted in', async () => {
  const admin = await signIn('A3001');
  const created = await call('POST', '/api/admin/elections',
    { title: 'Draft Test 2026' }, admin);
  const id = created.body.election.id;
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Ada Lo', party: 'Test Party' }, admin);

  const voter = await signIn('V1001');
  const ballot = await call('GET', `/api/elections/${id}/ballot`, undefined, voter);
  assert.equal(ballot.status, 200);
  assert.equal(ballot.body.election.status, 'draft');
  assert.equal(ballot.body.canVote, false);

  const attempt = await call('POST', `/api/elections/${id}/vote`,
    { candidateId: ballot.body.candidates[0].id }, voter);
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error, 'election_not_open');
});

// ------------------------------------------------------------------ T19
test('T19  candidates cannot be added once the session is open', async () => {
  const admin = await signIn('A3001');
  const created = await call('POST', '/api/admin/elections',
    { title: 'Locked Candidates 2026' }, admin);
  const id = created.body.election.id;
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Ada Lo', party: 'Test Party' }, admin);

  const opened = await call('POST', `/api/admin/elections/${id}/open`, undefined, admin);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.election.status, 'open');

  const late = await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Late Entry', party: 'Too Late' }, admin);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'election_locked');
});

// ------------------------------------------------------------------ T20
test('T20  an open election with a candidate accepts a vote end to end', async () => {
  const admin = await signIn('A3001');
  const created = await call('POST', '/api/admin/elections',
    { title: 'End To End 2026' }, admin);
  const id = created.body.election.id;

  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Wong Tin-lok', party: 'List A' }, admin);
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Cheung Mei', party: 'List B' }, admin);

  const opened = await call('POST', `/api/admin/elections/${id}/open`, undefined, admin);
  assert.equal(opened.status, 200);

  const voter = await signIn('V1002');
  const ballot = await call('GET', `/api/elections/${id}/ballot`, undefined, voter);
  assert.equal(ballot.body.canVote, true);
  assert.equal(ballot.body.candidates.length, 2);

  const voted = await call('POST', `/api/elections/${id}/vote`,
    { candidateId: ballot.body.candidates[1].id }, voter);
  assert.equal(voted.status, 201);

  // Closing makes the count publishable.
  const closed = await call('POST', `/api/admin/elections/${id}/close`, undefined, admin);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.election.status, 'closed');

  const results = await call('GET', `/api/results/${id}`, undefined, admin);
  assert.equal(results.status, 200);
  assert.equal(results.body.totalBallots, 1);
  assert.equal(results.body.results.find((x) => x.name === 'Cheung Mei').votes, 1);
  assert.equal(results.body.invariantHolds, true);
});

// ------------------------------------------------------------------ T21
test('T21  the state machine refuses invalid transitions and empty elections', async () => {
  const admin = await signIn('A3001');

  // An election with no candidates cannot be opened.
  const empty = await call('POST', '/api/admin/elections', { title: 'No Candidates 2026' }, admin);
  const emptyId = empty.body.election.id;
  const noCand = await call('POST', `/api/admin/elections/${emptyId}/open`, undefined, admin);
  assert.equal(noCand.status, 409);
  assert.equal(noCand.body.error, 'no_candidates');

  // draft -> closed is not an allowed edge.
  const bad = await call('POST', `/api/admin/elections/${emptyId}/close`, undefined, admin);
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error, 'invalid_transition');

  // closed -> open is not allowed either: there is no such edge in the state diagram.
  const db = getDb();
  const closed = db.prepare("SELECT id FROM elections WHERE status = 'closed' LIMIT 1").get();
  const reopen = await call('POST', `/api/admin/elections/${closed.id}/open`, undefined, admin);
  assert.equal(reopen.status, 409);
  assert.equal(reopen.body.error, 'invalid_transition');
});

// ------------------------------------------------------------------ T22
test('T22  creating an election is recorded in the audit log', async () => {
  const admin = await signIn('A3001');
  await call('POST', '/api/admin/elections', { title: 'Audited Creation 2026' }, admin);

  const auditor = await signIn('U4001');
  const log = await call('GET', '/api/audit?limit=100', undefined, auditor);
  const actions = log.body.entries.map((e) => e.action);
  assert.ok(actions.includes('election.created'), 'election.created must be logged');
  assert.ok(actions.includes('election.candidate_added'), 'candidate additions must be logged');
  assert.ok(actions.includes('election.open'), 'opening the session must be logged');
});
