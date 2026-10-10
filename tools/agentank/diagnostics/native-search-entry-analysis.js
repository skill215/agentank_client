"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function analyze(matches) {
  const buckets = {};
  for (const match of matches) for (const root of match.candidateEngine?.rootFrames || []) {
    const reason = root.searchEntryReason || "LEGACY_UNRECORDED";
    const bucket = buckets[reason] ||= { roots: 0, selectedActions: {},
      v1ActionAbsent: 0, v1HardBlocked: 0, v1RiskExcluded: 0,
      v1EligibleNotSelected: 0, agreement: 0 };
    bucket.roots++;
    const selected = root.candidates.find(row => row.row === root.selected);
    const key = selected?.action ?? -1;
    bucket.selectedActions[key] = (bucket.selectedActions[key] || 0) + 1;
    const reference = root.candidates.filter(row => row.action === root.v1Shadow?.resolvedAction);
    if (!reference.length) bucket.v1ActionAbsent++;
    else if (!reference.some(row => row.hard === 0)) bucket.v1HardBlocked++;
    else if (!reference.some(row => row.hard === 0 && row.acceptable)) bucket.v1RiskExcluded++;
    else if (selected?.action !== root.v1Shadow?.resolvedAction) bucket.v1EligibleNotSelected++;
    else bucket.agreement++;
  }
  return { warning: "Selected disagreement roots, not all frames. V1 labels are not correctness certificates.", buckets };
}
if (require.main === module) {
  const directory = path.resolve(process.argv[2]);
  const matches = zlib.gunzipSync(fs.readFileSync(path.join(directory, "matches.ndjson.gz")))
    .toString().trim().split("\n").filter(Boolean).map(JSON.parse);
  const report = analyze(matches);
  if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
module.exports = { analyze };
