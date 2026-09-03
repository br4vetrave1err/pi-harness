// Coder-Tester Loop - reusable workflowScript
// Usage: subagent({ workflowScriptPath: "workflows/coder-tester-loop.js", task: "your task" })
// Or via prompt: /prompt-workflow coder-tester-loop your task
// Max 3 rounds: coder -> tester -> coder(fix) -> tester ...

const task = typeof args !== 'undefined' && args.task ? args.task : "No task provided";

const coder1 = await runs.run("coder-1", {
  agent: "coder",
  task: `Implement and commit (detailed comments): ${task}\n\nRules: read context, implement, verify via bash, git add + git commit with detailed comments, report changes/verification.`
});

const tester1 = await runs.run("tester-1", {
  agent: "tester",
  task: `Independently test changes from coder-1 output:\n${coder1.output}\n\nFresh diff: git diff HEAD~1, run npm test/typecheck, report Test verdict: PASS/FAIL with proof.`
});

// If tester1 FAIL, fix and retest
if (tester1.output.includes("Test verdict: FAIL")) {
  const coder2 = await runs.run("coder-2", {
    agent: "coder",
    task: `Fix per tester-1 report:\n${tester1.output}\n\nPreserve scope, verify, commit, report.`
  });
  const tester2 = await runs.run("tester-2", {
    agent: "tester",
    task: `Independently re-test after fix:\n${coder2.output}\n\nWas previous issue resolved? Any new defects? Test verdict: PASS/FAIL`
  });
  if (tester2.output.includes("Test verdict: FAIL")) {
    const coder3 = await runs.run("coder-3", {
      agent: "coder",
      task: `Fix per tester-2 report:\n${tester2.output}`
    });
    const tester3 = await runs.run("tester-3", {
      agent: "tester",
      task: `Final re-test:\n${coder3.output}\nTest verdict: PASS/FAIL`
    });
    return { rounds: 3, final: tester3.output, coderOutputs: [coder1.output, coder2.output, coder3.output] };
  }
  return { rounds: 2, final: tester2.output, coderOutputs: [coder1.output, coder2.output] };
}
return { rounds: 1, final: tester1.output, coderOutputs: [coder1.output] };
