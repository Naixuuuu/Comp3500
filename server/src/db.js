import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';
import { hashPassword, encryptChoice, voterHash, newReceiptCode } from './crypto.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_id        TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('voter','officer','admin','auditor')),
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS elections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id),
  name        TEXT    NOT NULL,
  party       TEXT    NOT NULL
);

-- Who is entitled to vote in which election, and whether that right has been used.
-- D1 says "once per election", so the flag has to be keyed by election; a single
-- has_voted column on users would be wrong as soon as a second election exists.
CREATE TABLE IF NOT EXISTS voter_roll (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  has_voted   INTEGER NOT NULL DEFAULT 0,
  voted_at    TEXT,
  PRIMARY KEY (election_id, user_id)
);

-- Note: no user_id column. The ballot is keyed by voter_hash only (NF3).
CREATE TABLE IF NOT EXISTS ballots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id  INTEGER NOT NULL REFERENCES elections(id),
  voter_hash   TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  iv           TEXT    NOT NULL,
  tag          TEXT    NOT NULL,
  receipt_code TEXT    NOT NULL UNIQUE,
  created_at   TEXT    NOT NULL
);

-- Second line of defence against a double vote: the database refuses the second row even
-- if the service logic were bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ballot_election_voter
  ON ballots (election_id, voter_hash);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0
);
`;

let db;

export function getDb() {
  if (!db) throw new Error('database not initialised');
  return db;
}

/** Open (or create) the database and make sure the schema exists. */
export function openDb(file = DB_PATH) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

/**
 * Run `work` inside a single write transaction.
 *
 * BEGIN IMMEDIATE takes the write lock up front, so two concurrent requests cannot both
 * read has_voted = 0 and then both proceed. This is the mechanism behind requirement F7.
 */
export function inTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction may already be gone; the original error matters more */
    }
    throw err;
  }
}

/** Seed demo data on an empty database. */
export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  const now = new Date().toISOString();

  const insUser = db.prepare(
    'INSERT INTO users (voter_id, name, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  const people = [
    ['V1001', 'Alice Chan', 'voter'],
    ['V1002', 'Ben Wong', 'voter'],
    ['V1003', 'Cathy Lam', 'voter'],
    ['O2001', 'Officer Lee', 'officer'],
    ['A3001', 'Admin Ho', 'admin'],
    ['U4001', 'Auditor Ip', 'auditor'],
  ];
  const userId = {};
  for (const [voterId, name, role] of people) {
    const r = insUser.run(voterId, name, hashPassword('password123'), role);
    userId[voterId] = Number(r.lastInsertRowid);
  }

  const insElection = db.prepare(
    'INSERT INTO elections (title, status, created_at) VALUES (?, ?, ?)'
  );
  const e1 = Number(insElection.run('Student Union President 2026', 'open', now).lastInsertRowid);
  const e2 = Number(insElection.run('Faculty Representative 2026', 'closed', now).lastInsertRowid);

  const insCand = db.prepare(
    'INSERT INTO candidates (election_id, name, party) VALUES (?, ?, ?)'
  );
  const cands = {
    [e1]: [['Chan Ka-yan', 'Unity Slate'],
           ['Leung Wai-ming', 'Reform Slate'],
           ['Ng Sze-chit', 'Independent']],
    [e2]: [['Tam Ho-yin', 'Staff List'],
           ['Yip Man-ki', 'Student Voice']],
  };
  const candId = {};
  for (const [eid, list] of Object.entries(cands)) {
    for (const [n, party] of list) {
      const r = insCand.run(Number(eid), n, party);
      candId[`${eid}:${n}`] = Number(r.lastInsertRowid);
    }
  }

  // Everyone with a voter account is on the roll for both elections.
  const insRoll = db.prepare(
    'INSERT INTO voter_roll (election_id, user_id, has_voted) VALUES (?, ?, 0)'
  );
  for (const eid of [e1, e2]) {
    for (const vid of Object.keys(userId)) insRoll.run(eid, userId[vid]);
  }

  // Three ballots already cast in the closed election, so the results view has content.
  const insBallot = db.prepare(
    `INSERT INTO ballots (election_id, voter_hash, payload, iv, tag, receipt_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const markVoted = db.prepare(
    'UPDATE voter_roll SET has_voted = 1, voted_at = ? WHERE election_id = ? AND user_id = ?'
  );
  const seedVotes = [
    ['V1001', 'Tam Ho-yin'],
    ['V1002', 'Yip Man-ki'],
    ['V1003', 'Tam Ho-yin'],
  ];
  for (const [voterId, candName] of seedVotes) {
    const cid = candId[`${e2}:${candName}`];
    const enc = encryptChoice({ electionId: e2, candidateId: cid, candidateName: candName });
    insBallot.run(e2, voterHash(voterId, e2), enc.payload, enc.iv, enc.tag, newReceiptCode(), now);
    markVoted.run(now, e2, userId[voterId]);
  }

  db.prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .run('system', 'seed', 'demo data created', now);
}
