#!/usr/bin/env node
"use strict";

const { rejectCurrentCandidate } = require("../candidate/imp8-freeze");
try {
  const { disposition, file } = rejectCurrentCandidate();
  process.stdout.write(`${JSON.stringify({ status: disposition.status,
    candidateId: disposition.candidateId, reason: disposition.reason,
    gateFingerprint: disposition.gate.fingerprint, fingerprint: disposition.fingerprint,
    dispositionFile: file }, null, 2)}\n`);
} catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }
