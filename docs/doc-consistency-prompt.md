# Documentation audit prompt

Reusable prompt for auditing this repository's documentation against its code. Run it
after any change that alters behaviour, and before a release. It has two halves that must
be run in order: **verify**, then **deduplicate**. Never deduplicate first — you cannot
safely delete a statement until you know which copy is the correct one.

---

## Part 1 — Consistency: does the documentation match the code?

You are auditing documentation, not writing it. Treat every sentence in the docs as a
**claim to be checked against the source**, not as background you can trust. Documentation
is written once and drifts silently; the code is the only authority.

### Scope

Audit every one of these, and say so if a file has been added that this list misses:

- `README.md` — orientation and repository map
- `README_ENV.md` — production configuration and deployment
- `server/README.md` — the authoritative API and data-model reference
- `Android/README.md` — native client behaviour
- `web/README.md` — browser client behaviour
- `docs/*.md` — design decisions and rationale
- Any `CLAUDE.md`, contributing guide, or inline module doc-comment that states a rule

### Method

Work from the code outward, not from the docs inward. For each claim, find the line that
implements it.

**1. Mechanical checks — run these, do not eyeball them.**

- Every file path, module name, function name, class, and env var named in the docs still
  exists. Report anything that does not resolve.
- Every documented HTTP route exists in `server/src/routes/`, with the documented method
  and access level (`public` / `authenticated` / `student` / `staff` / `admin`). Check the
  middleware chain on the route, not the prose.
- Every route that exists is documented. An undocumented endpoint is a finding.
- Every documented model field exists in `server/src/models/`, and every field in those
  models is documented. Both directions.
- Every documented setting exists in `Settings`, and every setting is documented.
- Stated counts are current: number of tests, number of suites, versions, SDK levels,
  buffer defaults, timeouts, rotation intervals, rate limits.
- Internal links resolve, including anchors.

**2. Behavioural claims — verify by reading the implementation.**

For each of these, quote the code that proves or disproves the claim:

- Access-control statements ("admin only", "owner or admin", "students cannot see X").
  Verify against the actual guard, and verify the negative case too.
- Statements about what is *never* exposed to a client. Trace the actual response shape.
- Statements about what writes to the database, and under exactly which conditions.
- Statements about ordering, defaults, expiry, retries, idempotency, and error codes.
- Statements about the client's behaviour on failure paths.
- Any sentence containing "always", "never", "only", "cannot", or "guaranteed". These are
  the highest-value claims to check, because they are the ones readers rely on and the
  first to become false.

**3. Configuration reality check.**

Compare documented configuration against what production actually runs. A documented
example that differs from reality in a way that would mislead someone operating the system
is a finding, not a cosmetic issue — say which value is live and which is the example.

**4. Silence is a finding too.**

Behaviour a reader would be surprised to discover, that no document mentions, is missing
documentation. Prioritise: security-relevant behaviour, anything that writes or deletes
data, anything that fails closed, and any deliberate design decision that looks like a bug
to someone who does not know the reasoning.

### Report each finding as

| Claim (quoted from the doc) | Where | Code that settles it | Verdict | Fix |
|---|---|---|---|---|

Verdict is one of: **Correct**, **Stale** (was true, no longer), **Wrong** (never true),
**Imprecise** (true but misleading), **Missing** (code has no doc), **Orphaned** (doc has
no code).

### Rules

- Do not fix anything in Part 1. Report first, in full. A fix applied mid-audit hides the
  pattern of what drifted and why.
- Distinguish *verified by running something* from *verified by reading*. Say which.
- If a claim cannot be settled without running the system, say so rather than guessing.
- A comment in the code is also a claim, and can also be wrong. If a doc and a code
  comment disagree, both are findings until the behaviour settles it.
- Never mark a claim Correct because it sounds plausible or because the doc is well
  written. Cite the line.

---

## Part 2 — Redundancy: is the same thing said in more than one place?

Only after Part 1 is complete and its findings are fixed.

The goal is **one owner per fact**. A fact stated in four documents is not four times as
clear; it is three copies that will not be updated when the behaviour changes, and the
next reader has no way to tell which one is current. Every duplicate is a future
inconsistency that has not happened yet.

### Find it

Semantic duplication, not textual — the same fact rewritten in different words will not
show up in a diff, so a verbatim-match search will report nothing and prove nothing. For
every substantive fact, list every document that states it. Facts worth tracking here are:
verification rules and bands, what writes a record, access control, deletion semantics,
defaults and thresholds, rotation and expiry, client failure behaviour, and every
architectural rationale ("why X is served from Y").

### Assign ownership

Decide, once, which document owns each topic, then hold the line:

| Document | Owns |
|---|---|
| `README.md` | What this project is; the repository map; where to go next. **Summaries only** — no rules, no thresholds, no tables. |
| `README_ENV.md` | Configuration, deployment, operations. |
| `server/README.md` | The authoritative API contract, data model, and server behaviour. |
| `Android/README.md` | Native client behaviour and platform specifics. |
| `web/README.md` | Browser client behaviour and platform specifics. |
| `docs/*.md` | Why the design is what it is. Decisions and their reasoning, not the contract. |

The distinction that matters most: **`server/README.md` says what the rule is; the design
doc says why that rule was chosen.** Neither should do the other's job.

### Remove it

For each duplicate that is not in its owning document:

- Replace it with a one-line summary plus a link to the owner, or delete it outright if
  the surrounding text does not need it at all. A cross-reference is not a failure of the
  document — it is the only structure that survives the next behaviour change.
- Keep the *best* version, not the first one you found or the longest. Prefer the copy
  that is most precise, most current, and closest to the code it describes.
- Before deleting, confirm the surviving copy actually contains everything the deleted one
  did. Detail silently lost during a deduplication pass is worse than the duplication was.
- Preserve every measured number, every "this shipped as a bug once" note, and every
  explanation of *why*. These are the parts nobody can reconstruct later. If two copies
  each carry a unique detail, merge them into the owner before deleting.

### Do not remove

- The same fact stated at different depths for different audiences — a one-line summary in
  the root README and the full rule in `server/README.md` is correct structure, not
  duplication. What is wrong is two full statements of the same rule.
- Repetition inside a single document that serves navigation, such as a summary table
  followed by detail.
- A warning repeated at a genuine point of danger. If the reader can act destructively in
  two places, the warning belongs in both.

### Report

- A table of every fact that was duplicated, where it appeared, which document now owns it.
- Line counts before and after per file.
- Anything deliberately left duplicated, and why.
- **Any contradiction found between two copies** — this is the most valuable output of the
  whole exercise, because it means at least one document was already lying to its readers.

---

## Finishing

- Re-run every mechanical check from Part 1 after editing. Deduplication breaks links.
- Show a diff summary and state plainly what was verified by execution versus by reading.
- If any finding was left unfixed, say which and why.
