#!/usr/bin/env node
"use strict";

const { freezeImp8Candidate } = require("../candidate/imp8-freeze");
function flag(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
freezeImp8Candidate({ planPath: flag("--plan"), comparisonPath: flag("--comparison") })
  .then(({ manifest, manifestFile }) => process.stdout.write(`${JSON.stringify({ status: manifest.status,
    candidateId: manifest.candidateId, candidateFingerprint: manifest.fingerprint,
    publishArtifactSha256: manifest.build.minifiedSha256, manifestFile }, null, 2)}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
