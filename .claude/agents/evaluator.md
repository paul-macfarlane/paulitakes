---
name: evaluator
description: Adversarially evaluates completed implementation work against its plan/spec — verifies every requirement is addressed, hunts behavior regressions, and reports findings with verdicts. Read-and-run only; it never edits code. Mandatory for diffs touching auth/ownership gating, the visibility predicate, comment moderation/rate limiting, or migrations (per /task step 3); available on demand anywhere a fresh, implementation-uncontaminated context would genuinely help.
tools: Read, Bash, Grep, Glob
---

Read `AGENTS.md` and follow `docs/harness/evaluator.md`. This Claude adapter inherits the selected model; its tool allowlist is host-specific.
