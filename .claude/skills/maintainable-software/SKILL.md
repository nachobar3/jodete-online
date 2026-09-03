---
name: maintainable-software
description: Engineering judgment for writing code that stays cheap to change — simplicity, naming, boundaries, duplication, tests. Apply to any feature work, refactor, API design, or architecture decision, in any language.
---

# Maintainable software

The cost of software is the cost of changing it later. Every rule here
optimizes for the next reader and the next change, not for the author.

## Simplicity

- Solve the problem in front of you. Speculative generality — the parameter
  nobody passes, the interface with one implementation — is debt with no
  loan.
- Prefer boring constructs. Cleverness needs a comment; boring code doesn't.
- One concept per unit: a function that needs "and" in its description is two
  functions.

## Naming

- Names come from the domain, not the implementation: `settleInvoice`, not
  `processData2`.
- A name that needs a comment to be understood is the wrong name. Rename
  first, comment only for what code cannot say (constraints, why-not-the-
  obvious-way).
- Inconsistent vocabulary is a bug factory: one concept, one word, repo-wide.

## Boundaries and interfaces

- Narrow interfaces, deep modules: expose the smallest surface that serves
  the caller; keep the complexity behind it.
- Dependencies point one way. A module that reaches into its consumers — or
  into globals — can't be tested or replaced.
- Side effects live at the edges; the core is data in, data out. If a
  function both computes and writes, split it.

## Duplication

- Duplicate **shape** is fine; duplicate **concept** is not. Two functions
  that look alike but change for different reasons should stay apart; one
  business rule written twice will diverge and one copy will be wrong.
- Extract on the second real occurrence of the same concept, with a domain
  name. Extracting on resemblance creates the worst abstraction: the shared
  helper full of flags.

## Errors

- Make failure explicit at the boundary: validate input where it enters,
  fail with a message the caller can act on, never swallow.
- Impossible states should be unrepresentable (types, schemas, constraints)
  rather than checked everywhere.

## Tests

- Tests protect behavior, not implementation. A test that breaks on a
  rename is friction; a behavior change that breaks no test is a hole.
- Test the boundary you'd be afraid to change. If a bug got through, the
  first fix is the test that would have caught it.

## Changes

- The best diff is the smallest one that fully solves the problem. Refactors
  travel separately from behavior changes — a reviewer can hold one of them
  in their head, not both.
- Leave the campsite slightly cleaner, never reorganized: opportunistic
  renames yes, opportunistic redesigns no.
