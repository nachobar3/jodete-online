---
name: working-to-standard
description: Apply this repo's STANDARD.md while implementing, refactoring, or fixing. Use for any change that affects product behavior — before editing, while verifying, and when reporting done.
---

# Working to standard

`STANDARD.md` is the contract; this skill is how it's applied while the work
is happening, not checked after the fact.

## Before editing

1. Read `STANDARD.md`, including the module sections between the
   `facility:modules` markers — they carry domain rules (data, analytics,
   design, AI exposure) that change what "done" means.
2. Name the user-facing outcome, the affected boundaries, the invariants that
   must hold, and the rollback surface. If you can't, the task isn't clear
   enough to edit yet — ask the one question that unblocks it.
3. Find the local pattern first. The repo's existing shape beats the general
   best practice; new abstractions need to remove real complexity.

## While editing

- Deliver the WHOLE request as the smallest coherent change — no drive-by
  refactors, no "phase 1" unless phasing was requested.
- Keep side effects at the edges and visible: network, database, time,
  randomness, file system, model calls.
- Validate input at trust boundaries with the existing schema/parsing
  patterns; make invalid states hard to represent.
- When you touch a domain with a reviewer subagent in `.claude/agents/`,
  apply its checklist as you go — cheaper than failing its review later.

## Verifying

Run the lightest useful checks first, escalate by risk, per the verification
ladder in `STANDARD.md`. `node guards/run.mjs` is always cheap and always
relevant. A check you cannot run is reported by name with the reason — never
claimed.

## Reporting done

One concise summary: what changed and why, the checks you ran with their
results, and any genuinely out-of-scope follow-ups. Walk the completion
checklist in `STANDARD.md` before saying done; an unmet item is either fixed
or explicitly reported, never silent.
