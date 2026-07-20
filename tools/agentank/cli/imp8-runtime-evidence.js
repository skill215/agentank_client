#!/usr/bin/env node
"use strict";

const { writeRuntimeEvidence } = require("../calibration/v1-runtime-evidence");

try {
  const { report, directory } = writeRuntimeEvidence();
  process.stdout.write(`${JSON.stringify({ fingerprint: report.fingerprint,
    slowest: report.platformHistory.slowest,
    timeFallback: report.determinations.v1TimeFallbackActivationFromReplay,
    guaranteedFallback: report.determinations.v1GuaranteedFallbackMechanism,
    directory }, null, 2)}\n`);
} catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
