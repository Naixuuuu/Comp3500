# 5 · Software Evolution

> **中文摘要**
> 本文对应 Lecture 9（软件演化）。分两部分：**本次没做但知道该做什么**（下次迭代），
> 以及**为什么当前设计不会挡路**（保持可维护性）。
>
> 这里刻意区分了 **reengineering**（整体重构旧系统）和 **refactoring**（持续小步改进）——
> 本项目处于后者，尚无遗留系统。

## 5.1 Where this system sits in the life cycle

The system is in **evolution**, not servicing: it is in operational use for the demo and new
requirements are still being implemented. It is not a legacy system in the Lecture 9 sense —
it does not depend on obsolete technology, and its structure has not degraded.

Two properties were kept deliberately so that evolution stays cheap:

| Property | Why it matters for evolution |
|---|---|
| Business rules live only in the service layer | A new rule (say, "a voter may re-cast within 10 minutes") is a change to one function, not a hunt through routes and UI |
| Every significant action already writes an audit row | New behaviour is observable from day one; no retrospective instrumentation |
| Requirements are traceable to tests | Changing `F7` points straight at T7a and T7b, which is the impact analysis Lecture 9 describes |

## 5.2 Refactoring done during this iteration

`refactoring` is preventative maintenance: improving structure without adding function. Two
examples from this build, both driven by an inspection rather than by a bug report:

1. **`users.has_voted` → `voter_roll`.** The first schema had a single flag on `User`. That is
   correct for one election and wrong for two. The refactor moved the flag to a
   `(election_id, user_id)` row and added `voted_at`, which the paper path needed anyway.
   No feature was added; the model became correct.
2. **Results tally moved out of SQL.** The first version tried to `GROUP BY` candidate in SQL,
   which cannot work when the choice is encrypted. The fix decrypts in the service and counts
   in JavaScript. This is a structure improvement, not a new feature — but it also removed a
   class of bug (the JOIN silently counted every ballot for every candidate).

Both are small and local, which is the point: refactoring that is deferred becomes
reengineering.

## 5.3 Known limitations, in priority order

Named honestly rather than hidden. Each is a candidate requirement for the next iteration.

| # | Limitation | Consequence | Effort |
|---|---|---|---|
| 1 | **No create/edit election UI.** Elections and candidates are seeded; the API has no `POST /elections`. | UC1, UC10 and UC11 are modelled but not implemented. An administrator cannot run a real election without a developer. | Medium — 3 routes and 2 forms |
| 2 | **Single-node SQLite.** One writer. | Fine for 200 voters, not for a national election (see `03-architecture.md` §3.6). | High — replication and a distributed transaction |
| 3 | **The application holds the ballot key.** | An administrator with server access can decrypt ballots. | High — threshold cryptography |
| 4 | **No true concurrency test.** T7a/T7b cover the two mechanisms but not two OS processes racing. | A regression that only appears under real load would not be caught. | Low — a multi-process harness |
| 5 | **No session refresh, no CSRF token.** | A 30-minute session expires mid-form; the API trusts `Authorization` only, which is adequate for a token client but not for a cookie client. | Low |
| 6 | **`has_voted` is not reversible.** A voter who spoils a ballot needs an administrator with database access. | Real elections need a documented spoil-and-reissue procedure (D3 governs it). | Medium — a new use case, not a bug fix |
| 7 | **No verifiable bulletin board.** | The receipt proves the system *recorded* a vote, not that the vote *entered the tally*. | High — published commitments and a verifiable mix |

## 5.4 Maintenance categories

Lecture 9 defines three: fault repair, environmental adaptation, and functionality addition.
Mapping the list above:

- **Fault repairs** — none outstanding. The two inspections in `04-testing.md` §4.5 each found a
  defect and each is now covered by a test, so a regression would fail the suite.
- **Environmental adaptation** — limitation 2 (move to PostgreSQL) and limitation 5 (cookie
  support) are environment changes, not feature changes.
- **Functionality addition** — limitations 1, 3, 6 and 7. These are the next iteration's scope.

## 5.5 What would trigger reengineering

Lecture 9 frames reengineering as what you do when maintenance cost has already risen. The
signals to watch, in this system's terms:

| Signal | Threshold that would matter |
|---|---|
| `results.viewed` calls slowing down | decryption cost grows linearly with ballot count; at ~50 000 ballots per election a pre-aggregated tally becomes necessary |
| `vote.accepted` failures clustered on one election | indicates the transaction is contending, which points at the single-writer design |
| Duplicate-ballot exceptions appearing in logs | means the service check and the index disagree, which is a structural smell, not a data problem |

None of these are hit at demo scale, which is why the answer today is *refactor*, not
*reengineer*.

## 5.6 Change process for the next increment

The evolution process from Lecture 9, applied concretely:

1. **Change identification** — take limitation 1 (administrator CRUD) as the next change
   request. It is linked to `UC1`, `UC10`, `UC11` and to requirements F1, F9.
2. **Impact analysis** — the affected components are `routes/elections.js` (new routes),
   `votingService` (new functions), a new `ElectionView.vue`, and `voter_roll` seeding for a
   newly created election. No existing test should change; a new test T17 would cover
   "administrator creates an election, it appears in the list with status `draft`".
3. **Release planning** — one increment, because the change is additive and the schema needs
   no migration beyond what `voter_roll` already provides.
4. **Change implementation** — the same pattern as UC8: a route, a service function, a
   transaction where more than one row changes, and an audit call.
