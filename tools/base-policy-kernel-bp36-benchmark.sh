#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-/tmp/agentank-bp36-five-batch}"
LIMIT="${2:-8}"
NODE_BIN="${NODE_BIN:-/home/skill/.nvm/versions/node/v24.16.0/bin/node}"
export PATH="$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

run_arm() {
  local arm="$1"
  local batch="$2"
  local target="${OUTPUT}/batch-${batch}-${arm}"
  if [[ "${arm}" == "off" ]]; then
    bash "${ROOT}/tools/base-policy-kernel-bp30.sh" "${target}" "${LIMIT}" \
      > "${target}.log" 2>&1
  else
    bash "${ROOT}/tools/base-policy-kernel-bp36.sh" "${target}" "${LIMIT}" \
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
      pairCompleteCount:m.pairCompleteCount,pairIncompleteCount:m.pairIncompleteCount,
      canonicalHits:m.canonicalHitCount||0})+"\n");
  ' "${target}/overview.json" "${batch}" "${arm}" >> "${OUTPUT}/summary.ndjson"
}

rm -rf "${OUTPUT}"
mkdir -p "${OUTPUT}"
for batch in 1 2 3 4 5; do
  echo "[bp36-benchmark] batch ${batch}/5"
  if (( batch % 2 )); then
    run_arm off "${batch}"
    run_arm on "${batch}"
  else
    run_arm on "${batch}"
    run_arm off "${batch}"
  fi
done
"${NODE_BIN}" -e '
  const fs=require("node:fs");
  const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).map(JSON.parse);
  for(const arm of ["off","on"]){
    const a=rows.filter(r=>r.arm===arm), sum=k=>a.reduce((n,r)=>n+r[k],0);
    const ratio=a.reduce((n,r)=>n+r.candidateTotalMicros/r.controlTotalMicros,0)/a.length;
    const p95Ratio=a.reduce((n,r)=>n+r.candidateP95Max/r.controlP95Max,0)/a.length;
    console.log(JSON.stringify({arm,batches:a.length,elapsedMs:sum("elapsedMs"),
      candidateTotalMicros:sum("candidateTotalMicros"),
      controlTotalMicros:sum("controlTotalMicros"),meanCandidateControlRatio:ratio,
      meanP95Ratio:p95Ratio,pairCompleteCount:sum("pairCompleteCount"),
      pairIncompleteCount:sum("pairIncompleteCount"),canonicalHits:sum("canonicalHits")}));
  }
' "${OUTPUT}/summary.ndjson" | tee "${OUTPUT}/aggregate.ndjson"
