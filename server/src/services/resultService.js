import { getDb } from '../db.js';
import { decryptChoice } from '../crypto.js';
import * as audit from './auditService.js';
import { notFound, forbidden } from '../errors.js';

/**
 * UC9 — tally and view results.
 *
 * D4 says a result is publishable only as a complete count for a closed session, so the
 * status check comes first. Auditors and administrators may read a closed election; a voter
 * may not read the running total of an open one.
 *
 * The tally has to decrypt the ballots: the choice is stored as ciphertext, so SQL cannot
 * group by candidate. Decryption happens here, in the service layer, and the plaintext
 * never leaves this function — only per-candidate totals are returned.
 */
export function getResults(user, electionId) {
  const db = getDb();
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(electionId));
  if (!election) throw notFound('election_not_found', 'No such election');

  const privileged = user.role === 'auditor' || user.role === 'admin';
  if (election.status !== 'closed' && !privileged) {
    throw forbidden('results_not_published', 'Results are available only after the session closes');
  }

  const candidates = db
    .prepare('SELECT id, name, party FROM candidates WHERE election_id = ? ORDER BY id')
    .all(election.id);
  const ballots = db
    .prepare('SELECT id, payload, iv, tag FROM ballots WHERE election_id = ?')
    .all(election.id);

  const tally = new Map(candidates.map((c) => [c.id, 0]));
  let decryptFailures = 0;

  for (const b of ballots) {
    let choice;
    try {
      choice = decryptChoice(b);
    } catch {
      // A modified ciphertext fails the GCM tag check. Counting these separately is more
      // useful to an auditor than silently dropping them.
      decryptFailures += 1;
      continue;
    }
    if (tally.has(choice.candidateId)) {
      tally.set(choice.candidateId, tally.get(choice.candidateId) + 1);
    } else {
      decryptFailures += 1; // ballot refers to a candidate that no longer exists
    }
  }

  const totalVotes = [...tally.values()].reduce((a, n) => a + n, 0);

  // The invariant is about ONE election: ballots accepted here must not exceed the voters
  // who used their right here, which is why it reads voter_roll rather than users.
  const marked = db
    .prepare('SELECT COUNT(*) AS n FROM voter_roll WHERE election_id = ? AND has_voted = 1')
    .get(election.id).n;
  const onRoll = db
    .prepare('SELECT COUNT(*) AS n FROM voter_roll WHERE election_id = ?')
    .get(election.id).n;

  audit.record(user.voter_id, 'results.viewed', `election ${election.id}`);

  return {
    election: { id: election.id, title: election.title, status: election.status },
    results: candidates
      .map((c) => ({
        candidateId: c.id,
        name: c.name,
        party: c.party,
        votes: tally.get(c.id),
        share: totalVotes === 0 ? 0 : Number(((tally.get(c.id) / totalVotes) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.votes - a.votes || a.candidateId - b.candidateId),
    totalBallots: ballots.length,
    totalVotesCounted: totalVotes,
    decryptFailures,
    votersMarkedAsVoted: marked,
    votersOnRoll: onRoll,
    turnoutPercent: onRoll === 0 ? 0 : Number(((marked / onRoll) * 100).toFixed(1)),
    // D2 — the invariant an auditor checks first. It is computed, never trusted.
    invariantHolds: ballots.length <= marked && decryptFailures === 0,
  };
}
