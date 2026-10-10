"use strict";
// Development POC. A result becomes visible only after a complete layer.
function completeLayers(limit, maximumDepth, evaluate, admit = null) {
  const exhausted = Symbol("budget-exhausted");
  let used = 0, committed = null, completedDepth = 0;
  const attempts = [];
  let previousWork = 0, lastWork = 0;
  const spend = () => {
    if (used >= limit) throw exhausted;
    used++;
  };
  for (let depth = 1; depth <= maximumDepth; depth++) {
    if (admit && !admit(previousWork, lastWork, limit - used)) {
      attempts.push({depth, work: 0, status: "ADMISSION_REJECTED"});
      break;
    }
    const before = used;
    try {
      const result = evaluate(depth, spend);
      if (!result?.complete) {
        attempts.push({depth, work: used-before, status: "INCOMPLETE_SUPPORT", evidence: result?.evidence || null});
        break;
      }
      committed = result.value; completedDepth = depth;
      previousWork = lastWork; lastWork = used - before;
      attempts.push({depth, work: used-before, status: "COMPLETED", evidence: result.evidence || null});
    } catch (error) {
      if (error !== exhausted) throw error;
      attempts.push({depth, work: used-before, status: "BUDGET_INTERRUPTED"});
      break;
    }
  }
  return { used, completedDepth, committed, attempts };
}
module.exports = { completeLayers };
