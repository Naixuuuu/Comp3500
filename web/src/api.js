/**
 * One fetch wrapper for the whole client.
 *
 * The session token is kept in module state, not in localStorage: a ballot client that
 * survives a tab close is one more thing that can leak a token.
 */
const BASE = '/api';

let token = null;

export function setToken(t) { token = t; }
export function getToken() { return token; }

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'request_failed',
      data?.message || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login: (voterId, password) => request('POST', '/auth/login', { voterId, password }),
  verify: (challengeId, code) => request('POST', '/auth/verify', { challengeId, code }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),

  elections: () => request('GET', '/elections'),
  ballot: (id) => request('GET', `/elections/${id}/ballot`),
  vote: (id, candidateId) => request('POST', `/elections/${id}/vote`, { candidateId }),
  markVoted: (id, voterId) => request('POST', `/elections/${id}/mark-voted`, { voterId }),

  // ---- administration (role: admin) ----
  adminElection: (id) => request('GET', `/admin/elections/${id}`),
  createElection: (title, opensAt, closesAt) =>
    request('POST', '/admin/elections', { title, opensAt, closesAt }),
  updateElection: (id, changes) => request('PATCH', `/admin/elections/${id}`, changes),
  deleteElection: (id) => request('DELETE', `/admin/elections/${id}`),
  addCandidate: (id, name, party) =>
    request('POST', `/admin/elections/${id}/candidates`, { name, party }),
  updateCandidate: (id, changes) => request('PATCH', `/admin/candidates/${id}`, changes),
  deleteCandidate: (id) => request('DELETE', `/admin/candidates/${id}`),
  openElection: (id) => request('POST', `/admin/elections/${id}/open`),
  closeElection: (id) => request('POST', `/admin/elections/${id}/close`),

  results: (id) => request('GET', `/results/${id}`),
  audit: (limit = 200) => request('GET', `/audit?limit=${limit}`),
  receipt: (code) => request('GET', `/receipt/${encodeURIComponent(code)}`),
};
