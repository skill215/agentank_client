#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-bp37-five-batch}"
LIMIT="${2:-8}"
NODE_BIN="${NODE_BIN:-/home/skill/.nvm/versions/node/v24.16.0/bin/node}"
export PATH="$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

run_arm() {
  local arm="$1" batch="$2" target="${OUTPUT}/batch-${2}-${1}"
  if [[ "${arm}" == "base" ]]; then
    bash "${ROOT}/tools/base-policy-kernel-bp30.sh" "${target}" "${LIMIT}" \
      > "${target}.log" 2>&1
  else
    bash "${ROOT}/tools/base-policy-kernel-bp37.sh" "${target}" "${LIMIT}" \
      > "${target}.log" 2>&1
  fi
  "${NODE_BIN}" -e '
    const fs=require("node:fs");
    const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const r=p.candidate.runtime, m=p.candidate.nativeLongOptionResponseMass;
    process.stdout.write(JSON.stringify({batch:Number(process.argv[2]),
      arm:process.argv[3],elapsedMs:p.elapsedMs,
      candidateTotalMicros:r.candidateTotalMicros,
      controlTotalMicros:r.controlTotalMicros,
      candidateP95Max:r.candidateP95Max,controlP95Max:r.controlP95Max,
      complete:m.pairCompleteCount,incomplete:m.pairIncompleteCount,
      baseTransitions:m.baseTransitionCount,candidateTransitions:m.candidateTransitionCount,
      budgetStops:m.budgetStopCount,compacted:m.compactedActionCount||0})+"\n");
  ' "${target}/overview.json" "${batch}" "${arm}" >> "${OUTPUT}/summary.ndjson"
}

rm -rf "${OUTPUT}"
mkdir -p "${OUTPUT}"
for batch in 1 2 3 4 5; do
  echo "[bp37-benchmark] batch ${batch}/5"
  if (( batch % 2 )); then
    run_arm base "${batch}"
    run_arm compact "${batch}"
  else
    run_arm compact "${batch}"
    run_arm base "${batch}"
  fi
done
"${NODE_BIN}" -e '
  const fs=require("node:fs");
  const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).map(JSON.parse);
  for(const arm of ["base","compact"]){
    const a=rows.filter(r=>r.arm===arm), sum=k=>a.reduce((n,r)=>n+r[k],0);
    console.log(JSON.stringify({arm,batches:a.length,elapsedMs:sum("elapsedMs"),
      candidateTotalMicros:sum("candidateTotalMicros"),
      controlTotalMicros:sum("controlTotalMicros"),
      meanCandidateControlRatio:a.reduce((n,r)=>n+r.candidateTotalMicros/r.controlTotalMicros,0)/a.length,
      meanP95Ratio:a.reduce((n,r)=>n+r.candidateP95Max/r.controlP95Max,0)/a.length,
      complete:sum("complete"),incomplete:sum("incomplete"),
      baseTransitions:sum("baseTransitions"),candidateTransitions:sum("candidateTransitions"),
      budgetStops:sum("budgetStops"),compacted:sum("compacted")}));
  }
' "${OUTPUT}/summary.ndjson" | tee "${OUTPUT}/aggregate.ndjson"
