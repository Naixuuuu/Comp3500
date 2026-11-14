/**
 * Release testing: black-box checks against a running server.
 *
 * This is deliberately NOT under test/ — it needs a live server and a real SQLite file, so
 * it must not be picked up by `npm test`. Run it after `npm start`:
 *
 *   node scripts/smoke.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3100';

let failures = 0;

function ok(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}  ${extra}`);
  }
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
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
  if (a.status !== 200) throw new Error(`login failed for ${voterId}: ${JSON.stringify(a.body)}`);
  const b = await call('POST', '/api/auth/verify', {
    challengeId: a.body.challengeId, code: a.body.devOtp,
  });
  if (b.status !== 200) throw new Error(`verify failed for ${voterId}: ${JSON.stringify(b.body)}`);
  return b.body.token;
}

(async () => {
  console.log(`Release test against ${BASE}\n`);

  const health = await call('GET', '/api/health');
  ok('health endpoint', health.status === 200 && health.body.ok === true);

  // ---------------------------------------------------------------- voter flow
  console.log('\nVoter flow');
  const voterToken = await signIn('V1001');
  ok('two-factor sign-in returns a token',
    typeof voterToken === 'string' && voterToken.length === 64);

  const elections = await call('GET', '/api/elections', undefined, voterToken);
  ok('elections are listed', elections.status === 200 && elections.body.elections.length >= 2);

  const open = elections.body.elections.find((e) => e.status === 'open');
  const closed = elections.body.elections.find((e) => e.status === 'closed');
  ok('seed provides one open and one closed election', Boolean(open && closed));

  const ballot = await call('GET', `/api/elections/${open.id}/ballot`, undefined, voterToken);
  ok('ballot lists candidates', ballot.status === 200 && ballot.body.candidates.length === 3);

  if (ballot.body.canVote) {
    const voted = await call('POST', `/api/elections/${open.id}/vote`,
      { candidateId: ballot.body.candidates[0].id }, voterToken);
    ok('vote accepted with a receipt',
      voted.status === 201 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(voted.body.receiptCode));

    const again = await call('POST', `/api/elections/${open.id}/vote`,
      { candidateId: ballot.body.candidates[1].id }, voterToken);
    ok('second vote rejected', again.status === 409 && again.body.error === 'already_voted');

    const receipt = await call('GET', `/api/receipt/${voted.body.receiptCode}`);
    ok('receipt is recorded', receipt.body.recorded === true);
    ok('receipt does not reveal the choice',
      receipt.body.candidateId === undefined && receipt.body.candidateName === undefined);

    const naughty = await call('GET', `/api/results/${open.id}`, undefined, voterToken);
    ok('voter cannot read a running count', naughty.status === 403);

    const auditAsVoter = await call('GET', '/api/audit', undefined, voterToken);
    ok('voter cannot read the audit log', auditAsVoter.status === 403);
  } else {
    console.log('  SKIP  V1001 has already voted (this run is not the first against this database)');
    const again = await call('POST', `/api/elections/${open.id}/vote`,
      { candidateId: ballot.body.candidates[0].id }, voterToken);
    ok('repeat vote still rejected on a used database',
      again.status === 409 && again.body.error === 'already_voted');
  }

  // ---------------------------------------------------------------- auditor view
  console.log('\nAuditor view');
  const auditorToken = await signIn('U4001');
  const results = await call('GET', `/api/results/${closed.id}`, undefined, auditorToken);
  ok('auditor reads results', results.status === 200);
  ok('D2 invariant holds', results.body.invariantHolds === true);
  ok('per-candidate votes sum to the counted total',
    results.body.results.reduce((a, r) => a + r.votes, 0) === results.body.totalVotesCounted);
  ok('no decrypt failures on a clean database', results.body.decryptFailures === 0);

  const audit = await call('GET', '/api/audit?limit=200', undefined, auditorToken);
  ok('auditor reads the audit log', audit.status === 200 && audit.body.entries.length > 0);
  ok('audit contains login and vote events',
    audit.body.entries.some((e) => String(e.action).startsWith('vote.')) &&
    audit.body.entries.some((e) => String(e.action).startsWith('login.')));

  // ---------------------------------------------------------------- officer path
  console.log('\nOfficer path');
  const officerToken = await signIn('O2001');

  // The roll is finite, so after a few runs every voter is marked. The success path is
  // therefore best-effort, while the two negative checks always run: they are the ones that
  // prove the rule, and they stay valid on a database that has already been used.
  const candidates = ['V1003', 'V1002', 'A3001'];
  let markedVoter = null;
  for (const v of candidates) {
    const r = await call('POST', `/api/elections/${open.id}/mark-voted`, { voterId: v }, officerToken);
    if (r.status === 200) {
      markedVoter = v;
      ok(`officer marks a paper vote (${v})`, true);
      break;
    }
  }
  if (!markedVoter) {
    markedVoter = candidates[0];
    console.log('  SKIP  every candidate voter is already marked; the success path needs a '
      + 'fresh database (delete server/data/ and restart)');
  }

  const dup = await call('POST', `/api/elections/${open.id}/mark-voted`,
    { voterId: markedVoter }, officerToken);
  ok('marking the same voter twice is rejected',
    dup.status === 409 && dup.body.error === 'already_voted');

  const voterToken2 = await signIn(markedVoter);
  const after = await call('GET', `/api/elections/${open.id}/ballot`, undefined, voterToken2);
  ok('a paper voter can no longer vote electronically',
    after.body.hasVoted === true && after.body.canVote === false);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nRELEASE TEST ERROR:', e.message);
  process.exit(1);
});
