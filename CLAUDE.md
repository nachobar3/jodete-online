Follow AGENTS.md.

<!-- facility:start (managed by facility — edits inside this block may be overwritten by `facility update`) -->
## How work happens here (Facility)

This repository runs the [Facility method](https://github.com/theam/facility):
AI agents do real work in CI, humans own every decision that matters.

- **`STANDARD.md` is binding** for every change — human or agent. Read it
  before editing; reviewers enforce it.
- **`/architect`** (comment on an issue) plans and validates with real
  evidence. It never commits. **`/builder`** implements the approved plan end
  to end, runs the checks, and opens the PR. Invoking `/builder` is acceptance
  of the plan. Use exactly one command per comment, at the start of a line.
- Every non-draft PR is **reviewed automatically** against `STANDARD.md`.
  When a human submits a review on a crew PR, the agent **addresses the
  actionable feedback** and pushes. Agents never approve or merge — a human
  signs off.
- Verify before done: pnpm run typecheck ; pnpm run build. Deterministic repo invariants live in
  `guards/` (`node guards/run.mjs`).
- The craft lives in `.claude/skills/` (`working-to-standard`,
  `reviewing-to-standard`, `maintainable-software`; non-Claude agents: same
  content via `.agents/skills`). Apply them when implementing or reviewing.
  Slash commands `/verify` and `/open-pr` encode the standard's workflows.
- Issues move forward only on explicit human action. Don't start work on a
  task that isn't assigned and planned.
<!-- facility:end -->
