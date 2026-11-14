# 4 · Validation and Testing

> **中文摘要**
> 本文对应 Lecture 8（软件测试）。用三层来组织：**开发测试**（单元 + 组件 + 系统）、
> **发布测试**（黑盒、基于规格）、**用户测试**。
>
> 三个关键结论：
> 1. **测试只能证明错误的存在，不能证明其不存在** —— 所以本文不写"没有缺陷"，只写"哪些性质被验证过"。
> 2. **最值得测的是 D2 那条不变量**（已接受选票 ≤ 标记已投票人数），它比任何功能点都重要。
> 3. **原子性无法用顺序测试证明**，所以 T7 拆成两个互补的测试：服务层拒绝重复投票 + 数据库唯一索引拒绝重复行。

## 4.1 Test strategy

Lecture 8 splits validation into three stages. This project uses all three, at the scale a
single-iteration project can support:

| Stage | What it means here | Where it lives |
|---|---|---|
| **Development testing** | Tests the team runs while building | `server/test/api.test.js` (17 tests) |
| **Release testing** | Black-box checks against the specification, run on a complete build | `server/scripts/smoke.js` (17 checks on a fresh database) and `server/scripts/ui-check.js` (browser) |
| **User testing** | Acceptance from the point of view of each role | the demo script in §4.6 |

### Unit, component and system levels

| Level | Focus (Lecture 8) | In this project |
|---|---|---|
| **Unit** | one function or method | `crypto.js` primitives exercised through T3, T7b, T8: `verifyPassword`, `safeEqual`, `encryptChoice`/`decryptChoice`, `voterHash` |
| **Component** | the **interface** between units | the service boundary: each router calls exactly one service function, and T13/T15 check that a wrong argument is rejected rather than silently accepted |
| **System** | **interactions** between components, emergent behaviour | the full HTTP round trip in `smoke.js`, plus `ui-check.js` which drives the real browser |

## 4.2 Test cases

Identifiers match the traceability table in `01-requirements.md`.

| ID | Requirement | Test | Expected result |
|---|---|---|---|
| T1 | — | `GET /api/health` | 200 `{ok:true}` |
| T2 | F2 | login with a wrong password, and with an unknown voter id | both 401 `invalid_credentials`, identical body (no user enumeration) |
| T3 | F2, F3 | submit a wrong OTP, then replay the right one | 401 `invalid_otp`, then 401 `challenge_used` |
| T4 | F9 | vote in a `closed` election | 409 `election_not_open`, no ballot written |
| T5 | F4, F5 | read the ballot of an open election | 200; 3 candidates; `canVote = true` |
| T6 | F5, F6, F8 | cast one ballot | 201 with a receipt matching `^[A-Z2-9]{5}-[A-Z2-9]{5}$`; `hasVoted` becomes true |
| T7a | **F7, D2** | cast a second ballot | 409 `already_voted`; ballot count for that election stays **1** |
| T7b | **F7, D2** | insert a duplicate `(election_id, voter_hash)` row directly | the unique index raises; the database refuses it even if the service is bypassed |
| T8 | **NF2, NF3** | inspect the stored ballot row | payload contains no candidate name; `iv`/`tag` present; `voter_hash` is 64 hex chars |
| T9 | F14 | look up a receipt code | `recorded: true`, and **no** `candidateId` or `candidateName` in the response |
| T10 | F11 | read the audit log as an auditor | contains `login.success` and at least one `vote.*` |
| T11 | F13 | read the audit log as a voter | 403 `forbidden_role` |
| T12 | F13, D4 | read results of an **open** election as a voter | 403 `results_not_published` |
| T12b | F10, D2 | read results of a closed election as an auditor | 200; `invariantHolds = true`; per-candidate votes sum to `totalVotesCounted`; `decryptFailures = 0` |
| T13 | F4 | vote for a candidate belonging to a different election | 400 `candidate_not_in_election` |
| T14 | F12, D1 | officer marks a voter as voted on paper, twice | first 200; second 409; the voter can then no longer vote electronically |
| T15 | F13 | a voter calls the officer endpoint | 403 |
| T16 (`ui-check`) | F5–F8 | drive the real UI: sign in, pick a candidate, cast, read the receipt | a receipt code is displayed; no browser console errors |

### Why T7 is split into two tests

The requirement is that the ballot write and the roll update are one unit of work. A
sequential test cannot prove atomicity — it only proves the flag check works. So T7 has two
halves that fail for different reasons:

- **T7a** fails if the service forgets to check `has_voted`, or forgets to set it.
- **T7b** fails if the schema loses the unique index. It bypasses the service entirely and
  asks the database directly, which is the property that survives a future refactor of
  `votingService`.

Together they cover both mechanisms. What is **not** tested here is two truly concurrent OS
processes racing the same row; that needs a multi-process harness and is listed in
`05-evolution.md`. Being explicit about the gap is more useful than claiming coverage.

## 4.3 How the tests are run

```bash
cd server

npm test                    # 17 unit / component / system tests, in-memory database
npm start                   # then, in another shell:
node scripts/smoke.js          # black-box release checks against the running server
node scripts/ui-check.js    # drives the real UI in headless Edge and saves screenshots
```

`npm test` uses `node:test`, so there is no test framework dependency. The database is
`:memory:`, which is why the suite is repeatable and leaves nothing behind.

## 4.4 Test results

| Suite | Count | Result |
|---|---|---|
| `npm test` (unit → system) | 17 | **17 passed, 0 failed** |
| `scripts/smoke.js` (release testing) | 17 checks on a fresh database | **all passed; repeatable** |
| `scripts/ui-check.js` (browser) | 6 assertions + screenshots | **passed, no console errors** |

Current suite output:

```
✔ T1  health endpoint responds
✔ T2  wrong password is rejected without revealing the voter id
✔ T3  a wrong OTP is rejected and the challenge is burnt
✔ T4  a ballot is refused while the election is not open
✔ T5  the ballot lists candidates for an open election
✔ T6  casting a ballot returns a receipt and flips has_voted
✔ T7a a second vote by the same voter is rejected and the count stays 1
✔ T7b the unique index refuses a duplicate ballot even without the flag check
✔ T8  the stored ballot is ciphertext, not the candidate name
✔ T9  a receipt can be checked but does not reveal the choice
✔ T10 the audit log records authentication and voting
✔ T11 a voter may not read the audit log
✔ T12 results are refused for a voter on an open election
✔ T12b an auditor may read results and the D2 invariant holds
✔ T13 a candidate from another election is rejected
✔ T14 an officer can mark a paper vote, and it consumes the single-vote right
✔ T15 a voter cannot mark anyone as voted
```

## 4.5 Inspections alongside testing

Lecture 8 makes the point that inspections are **static** verification and complement
dynamic testing rather than compete with it. Three inspections were done here, and each
found something the tests would not have:

| Inspection | What it was | What it found |
|---|---|---|
| Requirement table vs. design | read §1.3 against the service methods | `F12` (paper path) had **no** code at all — a requirement with no implementation. It now exists as `UC8` / `POST /api/elections/:id/mark-voted`, and T14 covers it. |
| Class diagram vs. schema | read `fig5` against `db.js` | the first schema had a single `users.has_voted` column, but `D1` says *once per election*. Two elections made the model wrong, not just the code. Fixed by adding `voter_roll`; T14 is what proves it. |
| Sequence diagram vs. service | read `fig3` against `castBallot` | the first version wrote the ballot and set the flag in two steps; the gap between them allows a double vote. This is the modelling finding recorded in `02-system-modeling.md` §2.8. |

The second one is the most instructive: the defect was in the **model**, and it only became
visible when the model was compared against a second election. Testing alone would not have
found it, because the single-election demo passed.

## 4.6 Acceptance criteria and demo script

D4 says a result is publishable only as a complete count for a closed session, so the
acceptance walk-through uses the seeded closed election for results and the open one for
voting.

| # | Step | What to look for |
|---|---|---|
| 1 | Sign in as `V1001` / `password123`, enter the OTP shown | never reaches the ballot without the second factor |
| 2 | Pick a candidate, press **Cast ballot** | a receipt code appears; the same election now says the vote is recorded |
| 3 | Press **Cast ballot** again (reload first) | the button is gone; the API would answer 409 |
| 4 | Go to **Receipt**, enter the code | "Recorded" — and no candidate is shown |
| 5 | Sign out, sign in as `U4001` (auditor) | Results and Audit log tabs appear; a voter does not see them |
| 6 | Open **Results** on the closed election | counts sum to the total; **D2 OK** |
| 7 | Open **Audit log** | a `vote.accepted` entry for step 2 and a `login.success` for step 1 |
| 8 | Sign in as `O2001` (officer) and mark `V1003` as voted | that voter can no longer vote electronically |

Steps 1–8 are the acceptance test. They are manual on purpose: Lecture 8 notes that
influences from the user's environment cannot be replicated in a test harness, and the point
of this walk-through is that somebody other than the author can complete it.
