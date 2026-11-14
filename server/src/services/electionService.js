import { getDb, inTransaction } from '../db.js';
import * as audit from './auditService.js';
import { badRequest, conflict, notFound } from '../errors.js';

const VALID_TRANSITIONS = {
  draft: ['open'],
  open: ['closed'],
  closed: [],
};

/** Parse and validate a voting window. Both ends are required and must be ordered. */
function normaliseWindow(opensAt, closesAt) {
  const from = new Date(opensAt);
  const until = new Date(closesAt);
  if (Number.isNaN(from.getTime())) throw badRequest('invalid_dates', 'A valid start date is required');
  if (Number.isNaN(until.getTime())) throw badRequest('invalid_dates', 'A valid end date is required');
  if (until.getTime() <= from.getTime()) {
    throw badRequest('invalid_dates', 'The closing time must be after the opening time');
  }
  return { opensAt: from.toISOString(), closesAt: until.toISOString() };
}

function cleanTitle(title) {
  const clean = String(title || '').trim();
  if (clean.length < 3) throw badRequest('invalid_title', 'The title needs at least 3 characters');
  if (clean.length > 120) throw badRequest('invalid_title', 'The title is too long (120 characters maximum)');
  return clean;
}

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
    election: {
      id: election.id,
      title: election.title,
      status: election.status,
      opensAt: election.opens_at,
      closesAt: election.closes_at,
      createdAt: election.created_at,
    },
    candidates,
    votersOnRoll: onRoll,
    votersMarkedAsVoted: marked,
    totalBallots: ballots,
  };
}

/**
 * UC10 — create an election.
 *
 * A new election starts as `draft`, every registered user is enrolled on its roll, and the
 * voting window is recorded up front. Enrolling at creation time means the roll can be
 * inspected before the session opens.
 */
export function createElection(admin, title, opensAt, closesAt) {
  const clean = cleanTitle(title);
  const window = normaliseWindow(opensAt, closesAt);
  const db = getDb();

  return inTransaction(() => {
    const existing = db
      .prepare('SELECT id FROM elections WHERE title = ? AND status != ?')
      .get(clean, 'closed');
    if (existing) throw conflict('duplicate_election', 'An election with that title is already running');

    const ts = new Date().toISOString();
    const r = db
      .prepare(`INSERT INTO elections (title, status, opens_at, closes_at, created_at)
                VALUES (?, 'draft', ?, ?, ?)`)
      .run(clean, window.opensAt, window.closesAt, ts);
    const eid = Number(r.lastInsertRowid);

    const users = db.prepare('SELECT id FROM users').all();
    const insRoll = db.prepare(
      'INSERT INTO voter_roll (election_id, user_id, has_voted) VALUES (?, ?, 0)'
    );
    for (const u of users) insRoll.run(eid, u.id);

    audit.record(admin.voter_id, 'election.created',
      `${eid}: ${clean} (${users.length} on roll)`);
    return getElectionDetail(eid);
  });
}

/**
 * UC10 — edit an election's title or voting window.
 *
 * Editing stops at `closed`: once the count is publishable, letting anyone rewrite the
 * question that was asked would make the result meaningless. That mirrors D3, which says an
 * accepted vote cannot be changed.
 */
export function updateElection(admin, electionId, changes) {
  const eid = Number(electionId);
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');
    if (election.status === 'closed') {
      throw conflict('election_closed_immutable',
        'A closed election cannot be edited');
    }

    const title = changes.title === undefined ? election.title : cleanTitle(changes.title);
    const window = normaliseWindow(
      changes.opensAt === undefined ? election.opens_at : changes.opensAt,
      changes.closesAt === undefined ? election.closes_at : changes.closesAt,
    );

    if (title !== election.title) {
      const clash = db
        .prepare('SELECT id FROM elections WHERE title = ? AND id != ? AND status != ?')
        .get(title, eid, 'closed');
      if (clash) throw conflict('duplicate_election', 'Another running election uses that title');
    }

    db.prepare('UPDATE elections SET title = ?, opens_at = ?, closes_at = ? WHERE id = ?')
      .run(title, window.opensAt, window.closesAt, eid);

    const what = [];
    if (title !== election.title) what.push('title');
    if (window.opensAt !== election.opens_at || window.closesAt !== election.closes_at) {
      what.push('window');
    }
    audit.record(admin.voter_id, 'election.updated',
      `${eid}: ${what.length ? what.join(' + ') : 'no change'}`);

    return getElectionDetail(eid);
  });
}

/**
 * UC10 — delete an election.
 *
 * Refused once any ballot exists, for the same reason the service has no delete-ballot
 * function: a recorded vote is evidence, and deleting its election would delete the evidence.
 */
export function deleteElection(admin, electionId) {
  const eid = Number(electionId);
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');

    const ballots = db.prepare('SELECT COUNT(*) AS n FROM ballots WHERE election_id = ?')
      .get(eid).n;
    if (ballots > 0) {
      throw conflict('election_has_ballots',
        `This election has ${ballots} recorded ballot(s) and cannot be deleted`);
    }

    // candidates, the roll and any sessions describing it go with it
    db.prepare('DELETE FROM candidates WHERE election_id = ?').run(eid);
    db.prepare('DELETE FROM voter_roll WHERE election_id = ?').run(eid);
    db.prepare('DELETE FROM elections WHERE id = ?').run(eid);

    audit.record(admin.voter_id, 'election.deleted', `${eid}: ${election.title}`);
    return { ok: true, deletedId: eid };
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

/** UC11 — edit a candidate. Draft only, for the same reason as adding one. */
export function updateCandidate(admin, candidateId, changes) {
  const cid = Number(candidateId);
  const db = getDb();

  return inTransaction(() => {
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(cid);
    if (!candidate) throw notFound('candidate_not_found', 'No such candidate');

    const election = db.prepare('SELECT * FROM elections WHERE id = ?')
      .get(candidate.election_id);
    if (election.status !== 'draft') {
      throw conflict('election_locked',
        `Candidates cannot be changed once an election is ${election.status}`);
    }

    const name = changes.name === undefined ? candidate.name : String(changes.name).trim();
    const party = changes.party === undefined ? candidate.party : String(changes.party).trim();
    if (name.length < 2) throw badRequest('invalid_name', 'Candidate name is too short');
    if (!party) throw badRequest('invalid_party', 'Party or affiliation is required');

    if (name !== candidate.name) {
      const dup = db
        .prepare('SELECT id FROM candidates WHERE election_id = ? AND name = ? AND id != ?')
        .get(candidate.election_id, name, cid);
      if (dup) throw conflict('duplicate_candidate', 'Another candidate already has that name');
    }

    db.prepare('UPDATE candidates SET name = ?, party = ? WHERE id = ?').run(name, party, cid);
    audit.record(admin.voter_id, 'election.candidate_updated',
      `${candidate.election_id}: ${candidate.name} -> ${name}`);
    return getElectionDetail(candidate.election_id);
  });
}

/** UC11 — remove a candidate. Draft only: once open, removing one could change the outcome. */
export function deleteCandidate(admin, candidateId) {
  const cid = Number(candidateId);
  const db = getDb();

  return inTransaction(() => {
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(cid);
    if (!candidate) throw notFound('candidate_not_found', 'No such candidate');

    const election = db.prepare('SELECT * FROM elections WHERE id = ?')
      .get(candidate.election_id);
    if (election.status !== 'draft') {
      throw conflict('election_locked',
        `Candidates cannot be changed once an election is ${election.status}`);
    }

    db.prepare('DELETE FROM candidates WHERE id = ?').run(cid);
    audit.record(admin.voter_id, 'election.candidate_removed',
      `${candidate.election_id}: ${candidate.name}`);
    return getElectionDetail(candidate.election_id);
  });
}

/**
 * UC7 — open or close a voting session.
 *
 * The transition table is the one drawn in the state diagram (figure 6): draft → open →
 * closed, with no way back. Closing is what makes the count publishable.
 */
export function setStatus(admin, electionId, target) {
  const eid = Number(electionId);
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');

    const allowed = VALID_TRANSITIONS[election.status] || [];
    if (!allowed.includes(target)) {
      throw conflict('invalid_transition', `Cannot go from ${election.status} to ${target}`);
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

export const openElection = (admin, id) => setStatus(admin, id, 'open');
export const closeElection = (admin, id) => setStatus(admin, id, 'closed');
