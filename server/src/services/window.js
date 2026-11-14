/**
 * Shared voting-window logic.
 *
 * A ballot is accepted only when BOTH conditions hold:
 *   - the election status is `open` (the administrator's control), and
 *   - the current time is inside [opens_at, closes_at] (the scheduled window).
 *
 * Keeping them separate is deliberate: the status is what the administrator operates and
 * what the audit trail records, while the window is the rule the electoral calendar imposes.
 * Either one can stop a ballot, and the reason returned tells the voter which one did.
 *
 * The phase names here are deliberately NOT `open`/`closed`: those already mean the election
 * status, and reusing them made a response field ambiguous.
 */

export const PHASE = {
  BEFORE: 'before',
  INSIDE: 'inside',
  AFTER: 'after',
};

/** Which phase of its window an election is currently in. */
export function windowPhase(election, now = Date.now()) {
  const from = election.opens_at ? new Date(election.opens_at).getTime() : null;
  const until = election.closes_at ? new Date(election.closes_at).getTime() : null;
  if (from !== null && now < from) return PHASE.BEFORE;
  if (until !== null && now > until) return PHASE.AFTER;
  return PHASE.INSIDE;
}

/** Error code to return when the clock, rather than the status, blocks a ballot. */
export function windowErrorCode(phase) {
  if (phase === PHASE.BEFORE) return 'voting_not_started';
  if (phase === PHASE.AFTER) return 'voting_closed';
  return null;
}

/** Human-readable reason for a blocked ballot. */
export function windowMessage(phase, election) {
  if (phase === PHASE.BEFORE) {
    return `Voting opens on ${new Date(election.opens_at).toLocaleString()}`;
  }
  if (phase === PHASE.AFTER) {
    return `Voting closed on ${new Date(election.closes_at).toLocaleString()}`;
  }
  return '';
}
