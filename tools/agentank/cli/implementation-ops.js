#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { acceptImp0 } = require("../acceptance/imp0");
const { acceptImp1 } = require("../acceptance/imp1");
const { acceptImp2 } = require("../acceptance/imp2");
const { acceptImp3 } = require("../acceptance/imp3");
const { acceptImp4 } = require("../acceptance/imp4");
const { acceptImp5 } = require("../acceptance/imp5");
const { acceptImp6 } = require("../acceptance/imp6");
const { acceptImp7 } = require("../acceptance/imp7");
const { acceptImp8 } = require("../acceptance/imp8");
const { acceptImp9 } = require("../acceptance/imp9");

const HELP = `AgenTank implementation-stage acceptance

Usage:
  ./tools/implementation-toolchain.sh accept --stage IMP0
  ./tools/implementation-toolchain.sh accept --stage IMP1
  ./tools/implementation-toolchain.sh accept --stage IMP2
  ./tools/implementation-toolchain.sh accept --stage IMP3
  ./tools/implementation-toolchain.sh accept --stage IMP4
  ./tools/implementation-toolchain.sh accept --stage IMP5
  ./tools/implementation-toolchain.sh accept --stage IMP6
  ./tools/implementation-toolchain.sh accept --stage IMP7
  ./tools/implementation-toolchain.sh accept --stage IMP8
  ./tools/implementation-toolchain.sh accept --stage IMP9

The wrapper reruns the selected stage implementation gate before independent
acceptance. Stages without a registered acceptance adapter fail closed.
`;

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseStage(argv) {
  invariant(argv.length === 2 && argv[0] === "--stage", "INVALID_ACCEPTANCE_OPTIONS",
    "accept requires exactly --stage IMP<N>");
  invariant(/^IMP(?:10|[0-9])$/.test(argv[1]), "INVALID_ACCEPTANCE_STAGE",
    "stage must be IMP0 through IMP10");
  return argv[1];
}

function execute(command, argv = []) {
  if (command === "help" || command === "--help" || command === "-h") {
    return { kind: "help", value: HELP };
  }
  invariant(command === "accept", "UNKNOWN_ACCEPTANCE_COMMAND",
    `unknown acceptance command: ${command}`);
  const stage = parseStage(argv);
  if (stage !== "IMP0" && stage !== "IMP1" && stage !== "IMP2" && stage !== "IMP3" &&
      stage !== "IMP4" && stage !== "IMP5" && stage !== "IMP6" && stage !== "IMP7" &&
      stage !== "IMP8" && stage !== "IMP9") {
    throw new AgentankToolError("STAGE_ACCEPTANCE_NOT_IMPLEMENTED",
      `${stage} acceptance adapter is not implemented`);
  }
  const result = stage === "IMP0" ? acceptImp0() : stage === "IMP1" ? acceptImp1() :
    stage === "IMP2" ? acceptImp2() : stage === "IMP3" ? acceptImp3() :
    stage === "IMP4" ? acceptImp4() : stage === "IMP5" ? acceptImp5() :
    stage === "IMP6" ? acceptImp6() : stage === "IMP7" ? acceptImp7() :
    stage === "IMP8" ? acceptImp8() : acceptImp9();
  return { kind: "json", value: { operation: "accept", ...result.report,
    acceptanceFile: result.immutable }, exitCode: result.report.status === "ACCEPTED" ? 0 : 8 };
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value);
    else printJson(result.value);
    process.exitCode = result.exitCode || 0;
    return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_ACCEPTANCE_ERROR", error?.message ||
        "unexpected acceptance error", { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode;
    return { kind: "error", error: typed };
  }
}

if (require.main === module) main();

module.exports = { HELP, parseStage, execute, main };
