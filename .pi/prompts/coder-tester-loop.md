---
description: Coder-Tester loop until clean (coder implements & commits, tester validates independently)
---

Run a parent-orchestrated coder-tester loop for the requested work: $@

Use the `subagent` tool. Keep the parent session as the loop controller and final decision-maker. Child subagents must receive concrete role-specific tasks; they must not run subagents or manage the loop themselves.

Default to a maximum of 3 tester rounds unless I specify a different cap. Count a tester round each time a fresh-context tester inspects the current diff after a coder pass. Stop early when tester returns `Test verdict: PASS` or `PASS with notes` with no P0/P1 failures.

If the invocation includes an implementation request, first launch one async `coder` to implement the approved scope and commit with detailed comments. The coder must: read task/plan, implement, verify via bash, commit (`git add` + `git commit -m "feat: ..."` with comments), and report changes/verification. If the current diff is already the target, start with test.

The sequence can be launched up front with `workflowScript` when it is already clear, or continued as follow-up single-agent runs after each async completion. For an initial workflowScript, pass `async: true` so the main chat is unblocked.

For each tester round, launch a fresh-context `tester` agent. Tester must:
- inspect the repository and current diff directly from files and `bash` (`git diff HEAD`, `git log --oneline -1`, `git status`), not rely on parent history or coder summary
- run independent validation: `npm test` / `npm run typecheck` / relevant checks, capture exit codes
- report only concrete current issues with source proof, test output, or contract contradiction
- label findings P0/P1/P2 and end with `Test verdict: FAIL` or `Test verdict: PASS` or `Test verdict: PASS with notes`
P0 blocks, P1 should be fixed, P2 is report-only.

After tester returns, synthesize feedback into:
- P0 blockers or decisions needing user approval
- P1 fixes worth doing now
- P2 notes or optional improvements
- feedback to ignore/defer with reason

Do not blindly apply every tester suggestion. If tester surfaces an unapproved product/scope/architecture decision, pause and ask me before launching a fix coder.

When an async coder completes, treat its handoff as transition into test, not final completion. Launch tester immediately.

When there are P0/P1 fixes worth doing now and workflow is implementation-authorized, launch one async forked `coder` to apply only those synthesized fixes. Ask it to preserve approved scope, run focused validation, commit, and report changed files, commands with exit codes, validation, surprises, and anything left undone. Pass `coder` the tester report verbatim.

After a fix coder returns, run another tester round only when it made material changes or addressed non-trivial findings. Do not loop for optional polish or findings already deferred.

Stop and summarize when one of these is true:
- tester returns `Test verdict: PASS` / `PASS with notes` with no P0/P1 worth fixing
- remaining feedback is optional/speculative/deferred
- tester surfaces unapproved decision needing me
- max round cap reached

On completion, inspect final diff yourself, confirm validation, and summarize loop: rounds run, fixes applied, validation, remaining deferred items, and why loop stopped.

Additional task from invocation:

$@
