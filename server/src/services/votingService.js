import { getDb, inTransaction } from '../db.js';
import { encryptChoice, voterHash, newReceiptCode } from '../crypto.js';
import * as audit from './auditService.js';
import { badRequest, conflict, notFound, forbidden } from '../errors.js';
import {
  windowPhase, windowErrorCode, windowMessage, PHASE,
} from './window.js';

export function listElections() {
  return getDb()
    .prepare('SELECT id, title, status, opens_at, closes_at FROM elections ORDER BY id')
    .all()
    .map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      opensAt: e.opens_at,
      closesAt: e.closes_at,
      windowPhase: windowPhase(e),
    }));
}

/** The voter_roll row for (election, user), or undefined if the voter is not entitled. */
function rollFor(electionId, userId) {
  return getDb()
    .prepare('SELECT * FROM voter_roll WHERE election_id = ? AND user_id = ?')
    .get(electionId, userId);
}

/**
 * UC4 — show the ballot, gated by UC3.
 *
 * `canVote` folds together the three things that must be true: the session is open, the
 * current time is inside the voting window, and this voter has not already voted. `blockedBy`
 * says which one failed so the client can explain it instead of just disabling a button.
 */
export function getBallot(voterId, electionId) {
  const db = getDb();
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(electionId));
  if (!election) throw notFound('election_not_found', 'No such election');

  const user = db.prepare('SELECT * FROM users WHERE voter_id = ?').get(String(voterId));
  if (!user) throw forbidden('not_eligible', 'Voter not found');

  const roll = rollFor(election.id, user.id);
  if (!roll) throw forbidden('not_on_roll', 'This voter is not on the roll for that election');

  const candidates = db.prepare(
    'SELECT id, name, party FROM candidates WHERE election_id = ? ORDER BY id'
  ).all(election.id);

  const phase = windowPhase(election);
  const alreadyVoted = roll.has_voted === 1;

  let blockedBy = null;
  if (election.status !== 'open') blockedBy = 'election_not_open';
  else if (phase !== PHASE.INSIDE) blockedBy = windowErrorCode(phase);
  else if (alreadyVoted) blockedBy = 'already_voted';

  return {
    election: {
      id: election.id,
      title: election.title,
      status: election.status,
      opensAt: election.opens_at,
      closesAt: election.closes_at,
    },
    candidates,
    hasVoted: alreadyVoted,
    canVote: blockedBy === null,
    blockedBy,
    blockedMessage: blockedBy && blockedBy !== 'already_voted'
      ? windowMessage(phase, election)
      : '',
    windowPhase: phase,
  };
}

/**
 * UC5 — cast a ballot.
 *
 * Everything that must be true for the vote to count is re-checked inside one
 * BEGIN IMMEDIATE transaction: the election is open, the clock is inside the window, the
 * voter is on the roll, the right has not been used, and the candidate belongs to this
 * election. The ballot write and the roll update are the same unit of work, which is what
 * stops a double vote (F7 / D2).
 */
export function castBallot(user, electionId, candidateId) {
  const eid = Number(electionId);
  const cid = Number(candidateId);
  if (!Number.isInteger(eid) || !Number.isInteger(cid)) {
    throw badRequest('missing_fields', 'electionId and candidateId are required');
  }
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');
    if (election.status !== 'open') {
      throw conflict('election_not_open', 'This election is not open for voting');
    }

    const phase = windowPhase(election);
    if (phase !== PHASE.INSIDE) {
      throw conflict(windowErrorCode(phase), windowMessage(phase, election));
    }

    const voter = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!voter) throw forbidden('not_eligible', 'Voter not found');

    const roll = rollFor(eid, voter.id);
    if (!roll) throw forbidden('not_on_roll', 'This voter is not on the roll for that election');
    if (roll.has_voted === 1) {
      throw conflict('already_voted', 'This voter has already voted in this election');
    }

    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ? AND election_id = ?')
      .get(cid, eid);
    if (!candidate) {
      throw badRequest('candidate_not_in_election', 'That candidate is not on this ballot');
    }

    const enc = encryptChoice({
      electionId: eid,
      candidateId: cid,
      candidateName: candidate.name,
    });
    const receipt = newReceiptCode();
    const ts = new Date().toISOString();

    db.prepare(
      `INSERT INTO ballots (election_id, voter_hash, payload, iv, tag, receipt_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(eid, voterHash(voter.voter_id, eid), enc.payload, enc.iv, enc.tag, receipt, ts);

    db.prepare(
      'UPDATE voter_roll SET has_voted = 1, voted_at = ? WHERE election_id = ? AND user_id = ?'
    ).run(ts, eid, voter.id);

    audit.record(voter.voter_id, 'vote.accepted', `election ${eid}, receipt ${receipt}`);

    return { receiptCode: receipt, castAt: ts, electionTitle: election.title };
  });
}

/**
 * UC6 — check a receipt.
 *
 * Deliberately returns only whether the receipt exists. Returning the candidate would turn
 * the receipt into a way to prove how someone voted.
 */
export function checkReceipt(receiptCode) {
  const row = getDb().prepare(
    `SELECT b.receipt_code, b.created_at, e.title
       FROM ballots b JOIN elections e ON e.id = b.election_id
      WHERE b.receipt_code = ?`
  ).get(String(receiptCode || '').toUpperCase());
  if (!row) return { recorded: false };
  return { recorded: true, electionTitle: row.title, castAt: row.created_at };
}

/**
 * UC8 — presiding officer records that a voter voted on paper.
 *
 * Sets the same roll flag the electronic path sets, so the single-vote right is consumed
 * even though no ballot is created.
 */
export function markVotedOnPaper(officer, voterId, electionId) {
  const eid = Number(electionId);
  const db = getDb();

  return inTransaction(() => {
    const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(eid);
    if (!election) throw notFound('election_not_found', 'No such election');
    if (election.status !== 'open') {
      throw conflict('election_not_open', 'The session is not open');
    }
    const phase = windowPhase(election);
    if (phase !== PHASE.INSIDE) {
      throw conflict(windowErrorCode(phase), windowMessage(phase, election));
    }

    const target = db.prepare('SELECT * FROM users WHERE voter_id = ?').get(String(voterId));
    if (!target) throw notFound('voter_not_found', 'No such voter');

    const roll = rollFor(eid, target.id);
    if (!roll) throw forbidden('not_on_roll', 'That voter is not on the roll for this election');
    if (roll.has_voted === 1) throw conflict('already_voted', 'That voter has already voted');

    db.prepare(
      'UPDATE voter_roll SET has_voted = 1, voted_at = ? WHERE election_id = ? AND user_id = ?'
    ).run(new Date().toISOString(), eid, target.id);

    audit.record(officer.voter_id, 'vote.paper_path', `election ${eid}, voter ${voterId}`);
    return { ok: true, voterId, electionId: eid };
  });
}
