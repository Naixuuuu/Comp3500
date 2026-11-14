/**
 * Tests for the administration paths: creating, editing and deleting elections and
 * candidates, and the voting window.
 *
 * Identifiers T16..T28 continue the sequence in docs/04-testing.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, seedIfEmpty, getDb } from '../src/db.js';
import { createApp } from '../src/index.js';

let server;
let base;

const DAY = 86400000;
/** A voting window relative to now, in days. */
function win(fromDays, toDays) {
  return {
    opensAt: new Date(Date.now() + fromDays * DAY).toISOString(),
    closesAt: new Date(Date.now() + toDays * DAY).toISOString(),
  };
}

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

/** Create a draft election with an open window around now. */
async function makeElection(token, title, window = win(-1, 7)) {
  const r = await call('POST', '/api/admin/elections', { title, ...window }, token);
  assert.equal(r.status, 201, `createElection failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

// ------------------------------------------------------------------ T16
test('T16  an administrator creates a draft election with a voting window', async () => {
  const token = await signIn('A3001');
  const w = win(-1, 7);
  const r = await call('POST', '/api/admin/elections', { title: 'By-Election 2026', ...w }, token);
  assert.equal(r.status, 201);
  assert.equal(r.body.election.status, 'draft');
  assert.equal(r.body.candidates.length, 0);
  assert.ok(r.body.votersOnRoll >= 6, 'every registered user should be enrolled on the roll');
  assert.equal(r.body.election.opensAt, w.opensAt);
  assert.equal(r.body.election.closesAt, w.closesAt);

  const list = await call('GET', '/api/elections', undefined, token);
  const found = list.body.elections.find((e) => e.title === 'By-Election 2026');
  assert.ok(found, 'the new election must be visible in the election list');
  assert.equal(found.status, 'draft');
  assert.equal(found.opensAt, w.opensAt);
  assert.equal(found.windowPhase, 'inside', 'the seeded window is currently open');
});

// ------------------------------------------------------------------ T17
test('T17  a voter cannot create, edit or delete an election', async () => {
  const token = await signIn('V1001');
  const w = win(-1, 7);
  const create = await call('POST', '/api/admin/elections', { title: 'Rogue Election', ...w }, token);
  assert.equal(create.status, 403);
  assert.equal(create.body.error, 'forbidden_role');

  const patch = await call('PATCH', '/api/admin/elections/1', { title: 'Renamed' }, token);
  assert.equal(patch.status, 403);

  const del = await call('DELETE', '/api/admin/elections/1', undefined, token);
  assert.equal(del.status, 403);

  const officer = await signIn('O2001');
  const r2 = await call('POST', '/api/admin/elections', { title: 'Rogue Election', ...w }, officer);
  assert.equal(r2.status, 403, 'the presiding officer is not an administrator either');
});

// ------------------------------------------------------------------ T18
test('T18  a draft election cannot be voted in', async () => {
  const admin = await signIn('A3001');
  const created = await makeElection(admin, 'Draft Test 2026');
  const id = created.election.id;
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Ada Lo', party: 'Test Party' }, admin);

  const voter = await signIn('V1001');
  const ballot = await call('GET', `/api/elections/${id}/ballot`, undefined, voter);
  assert.equal(ballot.status, 200);
  assert.equal(ballot.body.election.status, 'draft');
  assert.equal(ballot.body.canVote, false);
  assert.equal(ballot.body.blockedBy, 'election_not_open');

  const attempt = await call('POST', `/api/elections/${id}/vote`,
    { candidateId: ballot.body.candidates[0].id }, voter);
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.error, 'election_not_open');
});

// ------------------------------------------------------------------ T19
test('T19  candidates are locked once the session is open', async () => {
  const admin = await signIn('A3001');
  const created = await makeElection(admin, 'Locked Candidates 2026');
  const id = created.election.id;
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Ada Lo', party: 'Test Party' }, admin);

  const opened = await call('POST', `/api/admin/elections/${id}/open`, undefined, admin);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.election.status, 'open');

  const add = await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Late Entry', party: 'Too Late' }, admin);
  assert.equal(add.status, 409);
  assert.equal(add.body.error, 'election_locked');

  const candId = opened.body.candidates[0].id;
  const patch = await call('PATCH', `/api/admin/candidates/${candId}`,
    { name: 'Renamed' }, admin);
  assert.equal(patch.status, 409);
  assert.equal(patch.body.error, 'election_locked');

  const del = await call('DELETE', `/api/admin/candidates/${candId}`, undefined, admin);
  assert.equal(del.status, 409);
  assert.equal(del.body.error, 'election_locked');
});

// ------------------------------------------------------------------ T20
test('T20  an open election with a live window accepts a vote end to end', async () => {
  const admin = await signIn('A3001');
  const created = await makeElection(admin, 'End To End 2026', win(-1, 1));
  const id = created.election.id;

  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Wong Tin-lok', party: 'List A' }, admin);
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Cheung Mei', party: 'List B' }, admin);

  const opened = await call('POST', `/api/admin/elections/${id}/open`, undefined, admin);
  assert.equal(opened.status, 200);

  const voter = await signIn('V1002');
  const ballot = await call('GET', `/api/elections/${id}/ballot`, undefined, voter);
  assert.equal(ballot.body.canVote, true);
  assert.equal(ballot.body.blockedBy, null);
  assert.equal(ballot.body.candidates.length, 2);

  const voted = await call('POST', `/api/elections/${id}/vote`,
    { candidateId: ballot.body.candidates[1].id }, voter);
  assert.equal(voted.status, 201);

  const closed = await call('POST', `/api/admin/elections/${id}/close`, undefined, admin);
  assert.equal(closed.status, 200);

  const results = await call('GET', `/api/results/${id}`, undefined, admin);
  assert.equal(results.status, 200);
  assert.equal(results.body.totalBallots, 1);
  assert.equal(results.body.results.find((x) => x.name === 'Cheung Mei').votes, 1);
  assert.equal(results.body.invariantHolds, true);
});

// ------------------------------------------------------------------ T21
test('T21  the state machine refuses invalid transitions and empty elections', async () => {
  const admin = await signIn('A3001');

  const empty = await makeElection(admin, 'No Candidates 2026');
  const emptyId = empty.election.id;
  const noCand = await call('POST', `/api/admin/elections/${emptyId}/open`, undefined, admin);
  assert.equal(noCand.status, 409);
  assert.equal(noCand.body.error, 'no_candidates');

  const bad = await call('POST', `/api/admin/elections/${emptyId}/close`, undefined, admin);
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error, 'invalid_transition');

  const db = getDb();
  const closed = db.prepare("SELECT id FROM elections WHERE status = 'closed' LIMIT 1").get();
  const reopen = await call('POST', `/api/admin/elections/${closed.id}/open`, undefined, admin);
  assert.equal(reopen.status, 409);
  assert.equal(reopen.body.error, 'invalid_transition');
});

// ------------------------------------------------------------------ T22
test('T22  every administrative action is recorded in the audit log', async () => {
  const admin = await signIn('A3001');

  // Perform all five actions here so the assertion does not depend on test order.
  const created = await makeElection(admin, 'Audited Creation 2026');
  const id = created.election.id;
  const added = await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Wong Tin-lok', party: 'List A' }, admin);
  await call('PATCH', `/api/admin/elections/${id}`, { title: 'Audited Creation 2026 (v2)' }, admin);
  await call('DELETE', `/api/admin/candidates/${added.body.candidates[0].id}`, undefined, admin);
  await call('DELETE', `/api/admin/elections/${id}`, undefined, admin);

  const auditor = await signIn('U4001');
  const log = await call('GET', '/api/audit?limit=200', undefined, auditor);
  const actions = log.body.entries.map((e) => e.action);
  for (const a of ['election.created', 'election.candidate_added', 'election.updated',
    'election.candidate_removed', 'election.deleted']) {
    assert.ok(actions.includes(a), `${a} must be logged`);
  }
});

// ------------------------------------------------------------------ T23
test('T23  an election can be edited while it is a draft or open, but not once closed', async () => {
  const admin = await signIn('A3001');
  const created = await makeElection(admin, 'Editable 2026', win(-1, 3));
  const id = created.election.id;

  const later = win(0, 10);
  const patched = await call('PATCH', `/api/admin/elections/${id}`,
    { title: 'Editable 2026 (revised)', ...later }, admin);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.election.title, 'Editable 2026 (revised)');
  assert.equal(patched.body.election.closesAt, later.closesAt);

  // A partial patch keeps the untouched field.
  const onlyTitle = await call('PATCH', `/api/admin/elections/${id}`,
    { title: 'Editable 2026 (final)' }, admin);
  assert.equal(onlyTitle.status, 200);
  assert.equal(onlyTitle.body.election.closesAt, later.closesAt, 'the window must be preserved');

  // Open it and edit again — still allowed.
  await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Ada Lo', party: 'P' }, admin);
  await call('POST', `/api/admin/elections/${id}/open`, undefined, admin);
  const whileOpen = await call('PATCH', `/api/admin/elections/${id}`,
    { ...win(0, 20) }, admin);
  assert.equal(whileOpen.status, 200, 'extending a live election must be possible');

  // Close it — now it is frozen.
  await call('POST', `/api/admin/elections/${id}/close`, undefined, admin);
  const afterClose = await call('PATCH', `/api/admin/elections/${id}`,
    { title: 'Too late' }, admin);
  assert.equal(afterClose.status, 409);
  assert.equal(afterClose.body.error, 'election_closed_immutable');
});

// ------------------------------------------------------------------ T24
test('T24  an election can be deleted only while it holds no ballots', async () => {
  const admin = await signIn('A3001');

  const disposable = await makeElection(admin, 'Disposable 2026');
  await call('POST', `/api/admin/elections/${disposable.election.id}/candidates`,
    { name: 'Ada Lo', party: 'P' }, admin);
  const del = await call('DELETE', `/api/admin/elections/${disposable.election.id}`,
    undefined, admin);
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);

  const gone = await call('GET', `/api/elections`, undefined, admin);
  assert.equal(gone.body.elections.some((e) => e.title === 'Disposable 2026'), false,
    'the deleted election must disappear from the list');

  // Anything that already recorded a ballot is evidence and cannot be removed.
  const db = getDb();
  const withBallots = db
    .prepare('SELECT election_id FROM ballots GROUP BY election_id LIMIT 1')
    .get();
  const refused = await call('DELETE', `/api/admin/elections/${withBallots.election_id}`,
    undefined, admin);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'election_has_ballots');
});

// ------------------------------------------------------------------ T25
test('T25  candidates can be edited and removed while the election is a draft', async () => {
  const admin = await signIn('A3001');
  const created = await makeElection(admin, 'Candidate Edits 2026');
  const id = created.election.id;

  const added = await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Wong Tin-lok', party: 'List A' }, admin);
  assert.equal(added.status, 201);
  const candId = added.body.candidates[0].id;

  const patched = await call('PATCH', `/api/admin/candidates/${candId}`,
    { name: 'Wong Tin-lok Jr', party: 'List A2' }, admin);
  assert.equal(patched.status, 200);
  const updated = patched.body.candidates.find((c) => c.id === candId);
  assert.equal(updated.name, 'Wong Tin-lok Jr');
  assert.equal(updated.party, 'List A2');

  // A duplicate name inside the same election is refused.
  const second = await call('POST', `/api/admin/elections/${id}/candidates`,
    { name: 'Cheung Mei', party: 'List B' }, admin);
  assert.equal(second.status, 201);
  const dup = await call('PATCH', `/api/admin/candidates/${second.body.candidates[1].id}`,
    { name: 'Wong Tin-lok Jr' }, admin);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'duplicate_candidate');

  const removed = await call('DELETE', `/api/admin/candidates/${candId}`, undefined, admin);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.candidates.length, 1);
});

// ------------------------------------------------------------------ T26
test('T26  a ballot is refused outside the voting window even while the session is open', async () => {
  const admin = await signIn('A3001');

  // Window opens tomorrow: session open, clock too early.
  const future = await makeElection(admin, 'Tomorrow 2026', win(1, 5));
  await call('POST', `/api/admin/elections/${future.election.id}/candidates`,
    { name: 'Ada Lo', party: 'P' }, admin);
  await call('POST', `/api/admin/elections/${future.election.id}/open`, undefined, admin);

  const voterA = await signIn('V1003');
  const ballotA = await call('GET', `/api/elections/${future.election.id}/ballot`,
    undefined, voterA);
  assert.equal(ballotA.body.canVote, false);
  assert.equal(ballotA.body.blockedBy, 'voting_not_started');
  assert.match(ballotA.body.blockedMessage, /Voting opens/);

  const tooEarly = await call('POST', `/api/elections/${future.election.id}/vote`,
    { candidateId: ballotA.body.candidates[0].id }, voterA);
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error, 'voting_not_started');

  // Window ended yesterday: session still open, clock too late.
  const past = await makeElection(admin, 'Yesterday 2026', win(-5, -1));
  await call('POST', `/api/admin/elections/${past.election.id}/candidates`,
    { name: 'Ben Ng', party: 'P' }, admin);
  await call('POST', `/api/admin/elections/${past.election.id}/open`, undefined, admin);

  const ballotB = await call('GET', `/api/elections/${past.election.id}/ballot`,
    undefined, voterA);
  assert.equal(ballotB.body.blockedBy, 'voting_closed');
  assert.match(ballotB.body.blockedMessage, /Voting closed/);

  const tooLate = await call('POST', `/api/elections/${past.election.id}/vote`,
    { candidateId: ballotB.body.candidates[0].id }, voterA);
  assert.equal(tooLate.status, 409);
  assert.equal(tooLate.body.error, 'voting_closed');
});

// ------------------------------------------------------------------ T27
test('T27  an election cannot be created with a nonsensical window', async () => {
  const admin = await signIn('A3001');

  const backwards = await call('POST', '/api/admin/elections', {
    title: 'Backwards 2026', opensAt: win(5, 0).opensAt, closesAt: win(0, 0).opensAt,
  }, admin);
  assert.equal(backwards.status, 400);
  assert.equal(backwards.body.error, 'invalid_dates');

  const missing = await call('POST', '/api/admin/elections', { title: 'No Dates 2026' }, admin);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'invalid_dates');

  const bad = await call('POST', '/api/admin/elections', {
    title: 'Bad Date 2026', opensAt: 'not-a-date', closesAt: new Date().toISOString(),
  }, admin);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_dates');
});

// ------------------------------------------------------------------ T28
test('T28  the election list exposes the window so the client can show it', async () => {
  const admin = await signIn('A3001');
  const list = await call('GET', '/api/elections', undefined, admin);
  assert.equal(list.status, 200);
  for (const e of list.body.elections) {
    assert.ok(e.opensAt, `${e.title} must expose opensAt`);
    assert.ok(e.closesAt, `${e.title} must expose closesAt`);
    assert.ok(['before', 'inside', 'after'].includes(e.windowPhase),
      `windowPhase must be one of the three phases, got ${e.windowPhase}`);
  }
});
