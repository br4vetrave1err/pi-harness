// Coder-Tester Loop - reusable workflowScript
// Usage: subagent({ workflowScriptPath: "workflows/coder-tester-loop.js", task: "your task", async: true })
// Or via prompt: /prompt-workflow coder-tester-loop your task
// Max 3 rounds: coder -> tester -> coder(fix) -> tester ... stops early on PASS / PASS with notes
// Branching: only continues if tester output contains "Test verdict: FAIL" (PASS with notes counts as PASS per prompt 9)

const task = typeof args !== 'undefined' && args.task ? String(args.task) : "No task provided";

function hasFail(output) {
  if (!output || typeof output !== 'string') return false;
  // Strict: look for "Test verdict: FAIL" — PASS with notes must not trigger
  return output.includes("Test verdict: FAIL");
}

try {
  const coder1 = await runs.run("coder-1", {
    agent: "coder",
    task: `Implement and commit (detailed comments): ${task}\n\nRules: read context, implement, verify via bash, git add + git commit with detailed comments, report changes/verification. Must include git diff, bash verification, and file list.`,
  });

  const tester1 = await runs.run("tester-1", {
    agent: "tester",
    task: `Independently test changes from coder-1 output:\n${coder1.output}\n\nFresh diff: git diff HEAD~1, run npm test/typecheck, report Test verdict: PASS/FAIL with proof (file:line, exit code). Do NOT trust coder summary — inspect files directly.`,
  });

  // If tester1 FAIL, fix and retest
  if (hasFail(tester1.output)) {
    const coder2 = await runs.run("coder-2", {
      agent: "coder",
      task: `Fix per tester-1 report:\n${tester1.output}\n\nPreserve approved scope, verify via bash (npm test/typecheck, git diff), commit (git add + git commit), report changes/verification. Do not blindly apply scope-changing suggestions — ask if needed.`,
    });
    const tester2 = await runs.run("tester-2", {
      agent: "tester",
      task: `Independently re-test after fix:\n${coder2.output}\n\nWas previous issue resolved? Any new defects? Check git diff HEAD~1 fresh. End with Test verdict: PASS/FAIL (or PASS with notes).`,
    });
    if (hasFail(tester2.output)) {
      const coder3 = await runs.run("coder-3", {
        agent: "coder",
        task: `Fix per tester-2 report:\n${tester2.output}\n\nFinal fix attempt (3rd round cap) — preserve scope, verify, commit.`,
      });
      const tester3 = await runs.run("tester-3", {
        agent: "tester",
        task: `Final re-test (3rd round cap):\n${coder3.output}\nTest verdict: PASS/FAIL — after this, parent will summarize even if FAIL.`,
      });
      return { rounds: 3, final: tester3.output, coderOutputs: [coder1.output, coder2.output, coder3.output], testerOutputs: [tester1.output, tester2.output, tester3.output] };
    }
    return { rounds: 2, final: tester2.output, coderOutputs: [coder1.output, coder2.output], testerOutputs: [tester1.output, tester2.output] };
  }
  return { rounds: 1, final: tester1.output, coderOutputs: [coder1.output], testerOutputs: [tester1.output] };
} catch (e) {
  // Ensure workflow never hangs silently — return error for parent to handle
  const msg = String(e && e.message ? e.message : e);
  return { rounds: 0, final: `Workflow error: ${msg}`, error: msg, coderOutputs: [] };
}
