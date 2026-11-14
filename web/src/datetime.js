/**
 * Date helpers shared by the administration screen and the ballot.
 *
 * The API stores ISO-8601 UTC strings; `<input type="datetime-local">` wants
 * `YYYY-MM-DDTHH:mm` in the browser's own zone. Everything that crosses that boundary goes
 * through these two functions so the conversion is written once.
 */

const pad = (n) => String(n).padStart(2, '0');

/** ISO string -> value for a datetime-local input (local time). */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO string (or null when empty). */
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Default window for the "create election" form: now until seven days from now. */
export function defaultWindow() {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  return { opensAt: toLocalInput(now.toISOString()), closesAt: toLocalInput(week.toISOString()) };
}

/** "15 Nov 2026, 09:00" */
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Short window summary, e.g. "15 Nov 2026, 09:00 → 22 Nov 2026, 18:00". */
export function formatWindow(opensAt, closesAt) {
  return `${formatDateTime(opensAt)} → ${formatDateTime(closesAt)}`;
}

/** How far away a boundary is, in words. */
export function describeRelative(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let amount;
  if (minutes < 60) amount = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  else if (hours < 36) amount = `${hours} hour${hours === 1 ? '' : 's'}`;
  else amount = `${days} day${days === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${amount}` : `${amount} ago`;
}

/** Label + tone for the window phase returned by the API. */
export function phaseBadge(phase) {
  if (phase === 'before') return { text: 'not started', tone: 'draft' };
  if (phase === 'after') return { text: 'window ended', tone: 'closed' };
  return { text: 'accepting ballots', tone: 'open' };
}
