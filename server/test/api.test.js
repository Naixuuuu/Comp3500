/**
 * API + service tests.
 *
 * Everything runs against an in-memory database so the suite is repeatable and leaves no
 * files behind. The identifiers T1..T12 match docs/04-testing.md.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, closeDb, seedIfEmpty, getDb } from '../src/db.js';
import { createApp } from '../src/index.js';
import { castBallot } from '../src/services/votingService.js';

let server;
let base;

before(async () => {
  openDb(':memory:');
  seedIfEmpty();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
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

/** Full two-factor sign-in; returns the token. */
async function signIn(voterId, password = 'password123') {
  const step1 = await call('POST', '/api/auth/login', { voterId, password });
  assert.equal(step1.status, 200, `login should succeed for ${voterId}`);
  const step2 = await call('POST', '/api/auth/verify', {
    challengeId: step1.body.challengeId,
    code: step1.body.devOtp,
  });
  assert.equal(step2.status, 200, 'otp verify should succeed');
  return step2.body.token;
}

// ------------------------------------------------------------------ T1
test('T1  health endpoint responds', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

// ------------------------------------------------------------------ T2
test('T2  wrong password is rejected without revealing the voter id', async () => {
  const r = await call('POST', '/api/auth/login', { voterId: 'V1001', password: 'nope' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'invalid_credentials');

  const unknown = await call('POST', '/api/auth/login', { voterId: 'ZZZZ', password: 'nope' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, 'invalid_credentials', 'same code for unknown user');
});

// ------------------------------------------------------------------ T3
test('T3  a wrong OTP is rejected and the challenge is burnt', async () => {
  const step1 = await call('POST', '/api/auth/login', { voterId: 'V1002', password: 'password123' });
  const bad = await call('POST', '/api/auth/verify', {
    challengeId: step1.body.challengeId, code: '000000',
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'invalid_otp');

  const replay = await call('POST', '/api/auth/verify', {
    challengeId: step1.body.challengeId, code: step1.body.devOtp,
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, 'challenge_used');
});

// ------------------------------------------------------------------ T4
test('T4  a ballot is refused while the election is not open', async () => {
  const token = await signIn('V1001');
  const elections = await call('GET', '/api/elections', undefined, token);
  const closed = elections.body.elections.find((e) => e.status === 'closed');
  assert.ok(closed, 'seed should contain a closed election');

  const r = await call('POST', `/api/elections/${closed.id}/vote`, { candidateId: 1 }, token);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'election_not_open');
});

// ------------------------------------------------------------------ T5
test('T5  the ballot lists candidates for an open election', async () => {
  const token = await signIn('V1003');
  const elections = await call('GET', '/api/elections', undefined, token);
  const open = elections.body.elections.find((e) => e.status === 'open');
  const r = await call('GET', `/api/elections/${open.id}/ballot`, undefined, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.candidates.length, 3);
  assert.equal(r.body.canVote, true);
  assert.equal(r.body.hasVoted, false);
});

// ------------------------------------------------------------------ T6
test('T6  casting a ballot returns a receipt and flips has_voted', async () => {
  const token = await signIn('V1003');
  const elections = await call('GET', '/api/elections', undefined, token);
  const open = elections.body.elections.find((e) => e.status === 'open');
  const ballot = await call('GET', `/api/elections/${open.id}/ballot`, undefined, token);
  const pick = ballot.body.candidates[0].id;

  const r = await call('POST', `/api/elections/${open.id}/vote`, { candidateId: pick }, token);
  assert.equal(r.status, 201);
  assert.match(r.body.receiptCode, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

  const after = await call('GET', `/api/elections/${open.id}/ballot`, undefined, token);
  assert.equal(after.body.hasVoted, true);
  assert.equal(after.body.canVote, false);
});

// ------------------------------------------------------------------ T7
test('T7a  a second vote by the same voter is rejected and the count stays 1', async () => {
  const token = await signIn('V1003');
  const elections = await call('GET', '/api/elections', undefined, token);
  const open = elections.body.elections.find((e) => e.status === 'open');
  const ballot = await call('GET', `/api/elections/${open.id}/ballot`, undefined, token);

  const again = await call('POST', `/api/elections/${open.id}/vote`,
    { candidateId: ballot.body.candidates[1].id }, token);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_voted');

  const db = getDb();
  const n = db.prepare('SELECT COUNT(*) AS n FROM ballots WHERE election_id = ?').get(open.id).n;
  assert.equal(n, 1, 'exactly one ballot must exist for this election');
});

test('T7b  the unique index refuses a duplicate ballot even without the flag check', () => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ballots LIMIT 1').get();
  assert.throws(
    () => db.prepare(
      `INSERT INTO ballots (election_id, voter_hash, payload, iv, tag, receipt_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.election_id, row.voter_hash, row.payload, row.iv, row.tag, 'ZZZZZ-ZZZZZ', 'now'),
    /UNIQUE|constraint/i,
    'the database itself must refuse a second ballot for the same voter'
  );
});

// ------------------------------------------------------------------ T8
test('T8  the stored ballot is ciphertext, not the candidate name', async () => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM ballots ORDER BY id DESC LIMIT 1')
    .get();
  assert.ok(row, 'a ballot should exist from T6');
  assert.doesNotMatch(row.payload, /Chan|Leung|Ng|Tam|Yip/,
    'the payload must not contain a candidate name in clear text');
  assert.ok(row.iv && row.tag, 'iv and auth tag must be stored');
  assert.match(row.voter_hash, /^[0-9a-f]{64}$/, 'voter_hash is a keyed hash');
});

// ------------------------------------------------------------------ T9
test('T9  a receipt can be checked but does not reveal the choice', async () => {
  const db = getDb();
  const row = db.prepare('SELECT receipt_code FROM ballots LIMIT 1').get();
  const r = await call('GET', `/api/receipt/${row.receipt_code}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, true);
  assert.equal(r.body.candidateId, undefined);
  assert.equal(r.body.candidateName, undefined);

  const missing = await call('GET', '/api/receipt/AAAAA-AAAAA');
  assert.equal(missing.body.recorded, false);
});

// ------------------------------------------------------------------ T10/T11
test('T10  the audit log records authentication and voting', async () => {
  const token = await signIn('U4001');
  const r = await call('GET', '/api/audit?limit=50', undefined, token);
  assert.equal(r.status, 200);
  const actions = r.body.entries.map((e) => e.action);
  assert.ok(actions.includes('login.success'));
  assert.ok(actions.some((a) => a.startsWith('vote.')));
});

test('T11  a voter may not read the audit log', async () => {
  const token = await signIn('V1001');
  const r = await call('GET', '/api/audit', undefined, token);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden_role');
});

// ------------------------------------------------------------------ T12
test('T12  results are refused for a voter on an open election', async () => {
  const token = await signIn('V1001');
  const elections = await call('GET', '/api/elections', undefined, token);
  const open = elections.body.elections.find((e) => e.status === 'open');
  const r = await call('GET', `/api/results/${open.id}`, undefined, token);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'results_not_published');
});

test('T12b  an auditor may read results and the D2 invariant holds', async () => {
  const token = await signIn('U4001');
  const elections = await call('GET', '/api/elections', undefined, token);
  const closed = elections.body.elections.find((e) => e.status === 'closed');
  const r = await call('GET', `/api/results/${closed.id}`, undefined, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.invariantHolds, true, 'accepted ballots must not exceed voters marked as voted');
  assert.equal(
    r.body.results.reduce((a, x) => a + x.votes, 0),
    r.body.totalVotesCounted,
    'per-candidate counts must sum to the number of ballots actually decrypted'
  );
  assert.equal(r.body.decryptFailures, 0);
});

// ------------------------------------------------------------------ T13
test('T13  a candidate from another election is rejected', async () => {
  const db = getDb();
  const open = db.prepare("SELECT id FROM elections WHERE status='open'").get();
  const other = db.prepare("SELECT id FROM elections WHERE status='closed'").get();
  const foreignCand = db.prepare('SELECT id FROM candidates WHERE election_id = ?').get(other.id);

  const token = await signIn('O2001');
  const elections = await call('GET', '/api/elections', undefined, token);
  assert.equal(elections.status, 200);
  assert.ok(elections.body.elections.length >= 2);

  const r = await call('POST', `/api/elections/${open.id}/vote`,
    { candidateId: foreignCand.id }, token);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'candidate_not_in_election');
});

test('T14  an officer can mark a paper vote, and it consumes the single-vote right', async () => {
  const token = await signIn('O2001');
  const db = getDb();
  const open = db.prepare("SELECT id FROM elections WHERE status='open'").get();

  const r = await call('POST', `/api/elections/${open.id}/mark-voted`,
    { voterId: 'V1002' }, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const again = await call('POST', `/api/elections/${open.id}/mark-voted`,
    { voterId: 'V1002' }, token);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_voted');

  // A voter marked on paper may not then vote electronically in the same election.
  const voterToken = await signIn('V1002');
  const ballot = await call('GET', `/api/elections/${open.id}/ballot`, undefined, voterToken);
  assert.equal(ballot.body.hasVoted, true);
  assert.equal(ballot.body.canVote, false);
});

test('T15  a voter cannot mark anyone as voted', async () => {
  const token = await signIn('V1001');
  const db = getDb();
  const open = db.prepare("SELECT id FROM elections WHERE status='open'").get();
  const r = await call('POST', `/api/elections/${open.id}/mark-voted`,
    { voterId: 'V1003' }, token);
  assert.equal(r.status, 403);
});
