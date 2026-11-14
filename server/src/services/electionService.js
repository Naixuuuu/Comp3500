import { getDb, inTransaction } from '../db.js';
import * as audit from './auditService.js';
import { badRequest, conflict, notFound } from '../errors.js';

const VALID_TRANSITIONS = {
  draft: ['open'],
  open: ['closed'],
  closed: [],
};

/** Election plus its candidates and roll counts, for the administrator's screen. */
export function getElectionDetail(electionId) {
  const db = getDb();
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(electionId));
  if (!election) throw notFound('election_not_found', 'No such election');

  const candidates = db
    .prepare('SELECT id, name, party FROM candidates WHERE election_id = ? ORDER BY id')
    .all(election.id);
  const onRoll = db
    .prepare('SELECT COUNT(*) AS n FROM voter_roll WHERE election_id = ?')
    .get(election.id).n;
  const marked = db
    .prepare('SELECT COUNT(*) AS n FROM voter_roll WHERE election_id = ? AND has_voted = 1')
    .get(election.id).n;
  const ballots = db
    .prepare('SELECT COUNT(*) AS n FROM ballots WHERE election_id = ?')
    .get(election.id).n;

  return {
    election: { id: election.id, title: election.title, status: election.status,
      createdAt: election.created_at },
    candidates,
    votersOnRoll: onRoll,
    votersMarkedAsVoted: marked,
    totalBallots: ballots,
  };
}

/**
 * UC10 — create an election.
 *
 * A new election starts as `draft` and every registered user is enrolled on its roll.
 * Enrolling at creation time (rather than at open time) means the roll can be inspected
 * before voting starts, which is what an administrator would actually want to check.
 */
export function createElection(admin, title) {
  const clean = String(title || '').trim();
  if (clean.length < 3) {
    throw badRequest('invalid_title', 'The title needs at least 3 characters');
  }
  if (clean.length > 120) {
    throw badRequest('invalid_title', 'The title is too long (120 characters maximum)');
  }
  const db = getDb();

  return inTransaction(() => {
    const existing = db
      .prepare('SELECT id FROM elections WHERE title = ? AND status != ?')
      .get(clean, 'closed');
    if (existing) throw conflict('duplicate_election', 'An election with that title is already running');

    const ts = new Date().toISOString();
    const r = db
      .prepare('INSERT INTO elections (title, status, created_at) VALUES (?, ?, ?)')
      .run(clean, 'draft', ts);
    const eid = Number(r.lastInsertRowid);

    // Enrol every registered user on the new roll.
    const users = db.prepare('SELECT id FROM users').all();
    const insRoll = db.prepare(
      'INSERT INTO voter_roll (election_id, user_id, has_voted) VALUES (?, ?, 0)'
    );
    for (const u of users) insRoll.run(eid, u.id);

    audit.record(admin.voter_id, 'election.created', `${eid}: ${clean} (${users.length} on roll)`);
    return getElectionDetail(eid);
  });
}

/** UC11 — add a candidate. Only while the election is still a draft. */
export function addCandidate(admin, electionId, name, party) {
  const eid = Number(electionId);
  const cleanName = String(name || '').trim();
  const cleanParty = String(party || '').trim();
  if (cleanName.length < 2) throw badRequest('invalid_name', 'Candidate name is too short');
  if (!cleanParty) throw badRequest('invalid_party', 'Party or affiliation is required');
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');
    if (election.status !== 'draft') {
      throw conflict('election_locked',
        `Candidates cannot be changed once an election is ${election.status}`);
    }

    const dup = db
      .prepare('SELECT id FROM candidates WHERE election_id = ? AND name = ?')
      .get(eid, cleanName);
    if (dup) throw conflict('duplicate_candidate', 'That candidate is already on the ballot');

    db.prepare('INSERT INTO candidates (election_id, name, party) VALUES (?, ?, ?)')
      .run(eid, cleanName, cleanParty);

    audit.record(admin.voter_id, 'election.candidate_added', `${eid}: ${cleanName}`);
    return getElectionDetail(eid);
  });
}

/**
 * UC7 — open or close a voting session.
 *
 * The transition table is the same one drawn in the state diagram (figure 6): draft → open →
 * closed, with no way back. An election that has been closed can never accept another
 * ballot, because there is no edge from `closed` at all.
 */
export function setStatus(admin, electionId, target) {
  const eid = Number(electionId);
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');

    const allowed = VALID_TRANSITIONS[election.status] || [];
    if (!allowed.includes(target)) {
      throw conflict('invalid_transition',
        `Cannot go from ${election.status} to ${target}`);
    }

    if (target === 'open') {
      const n = db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE election_id = ?')
        .get(eid).n;
      if (n < 1) {
        throw conflict('no_candidates', 'Add at least one candidate before opening the session');
      }
    }

    db.prepare('UPDATE elections SET status = ? WHERE id = ?').run(target, eid);
    audit.record(admin.voter_id, `election.${target}`, `${eid}: ${election.title}`);

    return getElectionDetail(eid);
  });
}

/** Convenience wrappers so the routes read cleanly. */
export const openElection = (admin, id) => setStatus(admin, id, 'open');
export const closeElection = (admin, id) => setStatus(admin, id, 'closed');
