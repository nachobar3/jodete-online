---
description: Run the right checks for the current change and report honestly
---

Verify the current working-tree change per STANDARD.md's verification ladder.

1. Look at the diff (`git status`, `git diff`) and classify what it touches:
   pure code, data/migrations, security surface, UI, analytics, agent
   surface.
2. Run the lightest relevant checks first, escalating by risk:

- `pnpm run typecheck`
- `pnpm run build`
- `node guards/run.mjs` — deterministic repo invariants. Always cheap; always run.

Escalate beyond this list when the change touches data, auth, or critical user flows — and say which extra checks ran.

3. Report a short table: check → result. Name every relevant check you did
   NOT run and why. Never summarize a failure away — paste the meaningful
   tail of the output and say what you'd try next.
