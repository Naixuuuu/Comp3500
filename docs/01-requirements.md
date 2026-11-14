# 1 · Requirements Engineering — Election Management and Voting System

> **中文摘要**
> 本文对应 Lecture 4（需求工程）。把需求分成四组：**功能需求 F1–F14**、**非功能需求 NF1–NF6**、
> **领域需求 D1–D4**，再用一节说明**不在范围内**的东西（避免范围蔓延）。
> 每条需求都写了理由（rationale），因为 L4 强调"需求必须可追溯、可验证"。
> 最关键的一条是 **F7 / NF2 / D2 三者必须同时成立**：一票只能投一次、选票内容不可被读出、
> 且投票人身份不能与选票内容关联——这三条互相牵制，是后面架构设计的出发点。

## 1.1 Scope

The system supports a single organisation running an election: registering voters, opening a voting
session, letting eligible voters cast **one** secret ballot each, and publishing a tally that an
independent auditor can verify.

The system deliberately **does not** cover:

| Out of scope | Why |
|---|---|
| Physical ballot printing | Outside software; handled by the presiding officer's existing procedure |
| Voter identity document issuance | Assumed to happen before the election, in another system |
| Political campaign or candidate nomination workflow | Not part of running the vote |
| Multi-tenant operation (several organisations per deployment) | Adds isolation complexity with no academic value here |
| Mobile native apps | A responsive web client covers the same use cases |

## 1.2 Stakeholders

| Stakeholder | Interest |
|---|---|
| Voter | Wants to vote quickly, and wants to be sure the vote was accepted without revealing it |
| Presiding Officer | Responsible for running the session at a polling station; needs to mark voters who voted on paper |
| Election Administrator | Sets up elections and candidates, opens and closes the session |
| Auditor | Independent of the administrators; needs evidence that the count is correct |

## 1.3 Functional requirements

`shall` marks a mandatory requirement; `should` marks a desirable one. Every requirement carries a
rationale, because a requirement without a reason cannot be defended when it is challenged.

| ID | Requirement | Rationale |
|---|---|---|
| **F1** | The system **shall** register voters with a unique voter ID, a name, and a role. | Every later check depends on a stable identity record. |
| **F2** | The system **shall** authenticate a voter with a password **and** a one-time password sent to a registered channel before any voting action is permitted. | A single factor is not adequate for an action that cannot be undone. |
| **F3** | The system **shall** mark an account locked after five consecutive failed authentication attempts. | Limits online guessing without locking out a forgetful voter on the first mistake. |
| **F4** | The system **shall** verify that a voter is assigned to the election and has not already voted, before accepting a ballot. | Eligibility and single-vote are the two rules the whole system exists to enforce. |
| **F5** | The system **shall** present the candidate list of the selected election, with name and party. | A vote is only meaningful if the options are unambiguous. |
| **F6** | The system **shall** accept exactly one candidate selection per ballot. | The electoral rule is one vote per voter per election; the interface enforces it. |
| **F7** | The system **shall** store the ballot and mark the voter as having voted **in a single atomic transaction**. | If either step can succeed alone, a voter can vote twice or lose a vote. See D2. |
| **F8** | The system **shall** return a receipt code to the voter after a ballot is accepted. | The voter needs non-repudiable evidence that the vote was recorded. |
| **F9** | The system **shall** let an administrator open and close a voting session, and **shall** reject ballots while the session is closed. | The session is the administrative control; nothing else can start or stop voting. |
| **F9b** | Each election **shall** carry an opening and a closing date-time, and the system **shall** reject ballots cast outside that window even while the session is open. | Two independent controls: the administrator operates the session, the electoral calendar defines when voting is lawful. Either one must be able to stop a ballot. |
| **F9c** | The system **shall** let an administrator edit an election's title and window until the session is closed, and **shall** refuse further edits afterwards. | Once the count is publishable, rewriting the question that was asked would make the result meaningless. |
| **F9d** | The system **shall** let an administrator delete an election only while no ballot has been recorded against it. | A recorded ballot is evidence, and deleting its election would delete the evidence (cf. D3). |
| **F10** | The system **shall** tally accepted ballots per candidate and expose the count plus the number of registered voters who voted. | Turnout is needed alongside the result to interpret it. |
| **F11** | The system **shall** record an audit entry for every authentication, ballot acceptance, session change, and result view. | The auditor's work depends on a complete, append-only record. |
| **F11b** | The system **shall** let an administrator add, edit and remove candidates while the election is a draft, and **shall** refuse all three once the session is open. | Editing the ballot after voting starts could change the outcome of votes already cast. |
| **F12** | The system **shall** let a presiding officer mark a voter as having voted without casting a ballot in the system. | Paper voting at a station must still consume the voter's single-vote right. |
| **F13** | The system **shall** restrict result viewing to auditors and administrators. | Publishing a partial count early can influence later voters. |
| **F14** | The system **should** let a voter check that their receipt code was recorded, without revealing the choice. | Supports confidence in the system without breaking ballot secrecy. |

## 1.4 Non-functional requirements

Each non-functional requirement is written as something measurable, not as an adjective — a
requirement you cannot test is not a requirement.

| ID | Requirement | Rationale |
|---|---|---|
| **NF1** | A ballot **shall** be accepted or rejected within **2 seconds** at the 95th percentile, with 200 concurrent voters on the reference hardware. | Voting happens in a short, crowded window; queueing is the main usability risk. |
| **NF2** | Ballot choices **shall** be unreadable from the database without the application key (AES-256-GCM at rest). | A database dump must not reveal how anyone voted. |
| **NF3** | The system **shall** keep the voter identity and the ballot choice in separate records that share no direct key. | Hiding the choice is worthless if the record still says who cast it. |
| **NF4** | The system **shall** remain available during the published voting window, with a target of 99.5% and no planned downtime inside the window. | A voter turned away cannot come back later. |
| **NF5** | The web client **shall** be usable on a 360 px wide screen and reachable by keyboard only. | Voting stations and personal phones both have to work. |
| **NF6** | The system **shall** log every rejected ballot with a reason code, retained for the statutory period. | Disputes are resolved from the log, not from memory. |

## 1.5 Domain requirements

These come from electoral practice rather than from the software, and they constrain the design in
ways a generic "voting app" would miss.

| ID | Requirement | Rationale |
|---|---|---|
| **D1** | A voter **shall** be able to exercise the franchise **once per election**, whether the vote is cast on paper or in the system. | The single-vote rule is the legal basis of the election, not an implementation detail. |
| **D2** | The number of accepted ballots **shall** never exceed the number of voters marked as having voted. | This is the invariant an auditor checks first; it must hold after every transaction, including a crash. |
| **D3** | A vote, once accepted, **shall not** be amendable or deletable by any role, including the administrator. | An amendable vote is not a secret ballot; it is a recorded preference. |
| **D4** | The result **shall** be publishable only as a complete count for a closed session. | Partial counts during voting are a known influence channel. |
| **D5** | Voting **shall** be possible only between the published opening and closing date-times. | A ballot cast outside the advertised period has no legal standing, whatever the software does. |

## 1.6 Validation of these requirements

Lecture 4 defines five checks. Applying them to the table above:

| Check | What was examined | Outcome |
|---|---|---|
| **Validity** | Does each requirement serve a stakeholder need? | F14 was kept as `should` because it serves confidence, not the count itself. |
| **Consistency** | Do any two requirements conflict? | F9 (reject while closed) and F12 (officer marks voted) were checked: marking a voter is allowed while open only, so they do not conflict. |
| **Completeness** | Is any actor's need unserved? | The auditor's need for evidence produced F11; without it the role had no purpose. |
| **Realism** | Achievable with the chosen stack in one iteration? | NF1 at 200 concurrent voters is achievable; a 20 000-voter national election is **not** claimed. |
| **Verifiability** | Can each be tested? | NF1 names a percentile and a load; NF2 names an algorithm; D2 names an invariant that a test can assert. |

## 1.7 Requirement-to-design traceability

| Requirement | Realised by | Verified by |
|---|---|---|
| F2 | `POST /api/auth/login` + `/verify`, OTP challenge table | T2, T3 |
| F4, D1, D2 | Single `BEGIN IMMEDIATE` transaction in `votingService.castBallot` | T6, T7 |
| F7, NF3 | Ballot row stores `voter_hash` only; `voter_roll.has_voted` holds the per-election flag | T6, T7a, T7b |
| NF2 | `crypto.createCipheriv('aes-256-gcm')` before insert | T8 |
| F8, F14 | `receipt_code` column, `GET /api/vote/receipt/:code` | T9 |
| F11 | `audit_log` table, one row per event | T10 |
| F12 | `POST /api/elections/:id/mark-voted`, officer role only | T14 |
| F13 | `requireRole('auditor','admin')` middleware | T11 |
| F9 | `elections.status` checked inside the transaction; `POST /api/admin/elections/:id/open|close` | T4, T18, T19, T21 |
| F9b | `services/window.js`; checked in `castBallot` inside the same transaction | T26 |
| F9c | `PATCH /api/admin/elections/:id`, refused when status is `closed` | T23 |
| F9d | `DELETE /api/admin/elections/:id`, refused when ballots exist | T24 |
| F11b | `POST/PATCH/DELETE /api/admin/candidates/...`, refused when not `draft` | T19, T25 |
| F1 | `POST /api/admin/elections` creates the election and its roll | T16 |
| F10 | `resultService.getResults` decrypts and tallies | T20, T12b |

The test identifiers T1–T12 refer to `docs/04-testing.md`.
