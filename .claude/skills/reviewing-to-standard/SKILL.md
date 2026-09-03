---
name: reviewing-to-standard
description: Review code changes against this repo's STANDARD.md. Use when reviewing a PR, a diff, or another agent's work — enforces the review order, the comment quality bar, and severity discipline.
---

# Reviewing to standard

A review exists to change the implementer's next action. Everything else is
noise.

## Review order (stop-the-line first)

1. **Correctness and fit** — the change does what was asked, no more. Scope
   creep is a finding, not a bonus.
2. **Security and privacy** — auth regressions, data exposure, secret
   handling, injection paths, new attack surface. Verify the negative case;
   never accept a prose claim that a boundary holds.
3. **Maintainability** — same concept reused not duplicated, clear ownership
   boundaries, domain names, side effects visible, easy for the next caller
   and the next test.
4. **Standard compliance** — `STANDARD.md` and its module sections were
   followed. A missed module requirement (seeds, analytics, evidence,
   exposure) is a product-quality gap, not optional polish.
5. **Verification evidence** — the right checks ran for the risk taken, and
   skipped checks are named. `node guards/run.mjs` should be green.

## The comment contract

Every finding carries four things: `file:line`, the exact risk, the smallest
practical fix, and the standard it missed. Severity is explicit — Blocker /
High / Medium — and separated from optional suggestions. Never post:

- Style-only nits, unless they hide a real bug or future maintenance cost.
- Vague asks ("clean this up", "add tests") — name the missing case, command,
  or assertion instead.
- Requests for broad rewrites when a narrow change closes the risk.

## Leverage

For domains with real risk, dispatch the matching reviewer subagent from
`.claude/agents/` and consolidate its findings rather than re-deriving them.
If the same problem has now appeared twice in reviews, the review is the
wrong tool: propose the guard (`guards/`) that makes the third occurrence
impossible, and say so in the review.

## Verdict

End with **Ready / Ready with follow-ups / Not ready**, the checks you ran,
and nothing else. You never approve or merge — that signature is human.
