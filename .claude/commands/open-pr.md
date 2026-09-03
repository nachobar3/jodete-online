---
description: Open a concise, team-lead-ready PR following STANDARD.md
---

Open a pull request for the current branch following STANDARD.md's PR rules.

1. Preconditions: branch name is semantic (`feature/...`, `fix/...`, ... —
   no agent/tool prefixes); commits follow Conventional Commits; the
   relevant checks from /verify have run in this session — if not, run them
   first.
2. Push the branch and create the PR with `gh pr create` targeting
   master, with:
   - A Conventional-Commits title describing the product/domain intent.
   - The body structure from STANDARD.md (Summary / Context / Verification /
     Linked issues) — tight, no implementation diary, no filler.
   - The full issue URL when one exists in the branch name, commits, or
     conversation, as a `Closes #<n>` closing keyword. Never invent issue
     links.
3. Mention what was intentionally NOT touched (migrations, analytics,
   security surface) when a reviewer would otherwise expect it.
4. Print the PR URL.
