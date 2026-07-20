"use strict";

const { requireVariant } = require("./errors");

function outcomeForWinner(winnerSeat, perspectiveSeat) {
  return winnerSeat === perspectiveSeat ? "WIN" : "LOSS";
}

function exactTieResolution(context, trigger, cause, perspectiveSeat) {
  const variant = requireVariant(context, "EXACT_RUNTIME_TIE_V1", "R0-TERMINAL-PRIORITY");
  if (variant === "DRAW") return { status: "RESOLVED", trigger, tiebreak: "EXACT_TIE",
    cause: "EXACT_DRAW", winnerSeat: null, outcome: "DRAW", perspectiveSeat };
  return { status: "UNKNOWN_RULE", trigger, tiebreak: "EXACT_TIE", cause,
    winnerSeat: null, outcome: null, perspectiveSeat, firstUnknownRuleId: "R0-TERMINAL-PRIORITY" };
}

function tiebreak(state, context, trigger, starCause, runtimeCause, perspectiveSeat) {
  const [left, right] = state.tanks;
  if (left.stars !== right.stars) {
    const winnerSeat = left.stars > right.stars ? 0 : 1;
    return { status: "RESOLVED", trigger, tiebreak: "STAR", cause: starCause,
      winnerSeat, outcome: outcomeForWinner(winnerSeat, perspectiveSeat), perspectiveSeat };
  }
  if (left.runtimeMs === null || right.runtimeMs === null) {
    return { status: "INCOMPLETE_STATE", trigger, tiebreak: "RUNTIME", cause: runtimeCause,
      winnerSeat: null, outcome: null, perspectiveSeat, incompleteReason: "RUNTIME_ORDER_UNKNOWN" };
  }
  if (left.runtimeMs !== right.runtimeMs) {
    const winnerSeat = left.runtimeMs < right.runtimeMs ? 0 : 1;
    return { status: "RESOLVED", trigger, tiebreak: "RUNTIME", cause: runtimeCause,
      winnerSeat, outcome: outcomeForWinner(winnerSeat, perspectiveSeat), perspectiveSeat };
  }
  return exactTieResolution(context, trigger, runtimeCause, perspectiveSeat);
}

function resolve(state, context, perspectiveSeat = 0) {
  const flags = state.terminalFlags;
  if (flags.scriptErrorSeat !== null) {
    const winnerSeat = flags.scriptErrorSeat ^ 1;
    return { status: "RESOLVED", trigger: "SCRIPT_ERROR", tiebreak: "NONE", cause: "SCRIPT_ERROR",
      winnerSeat, outcome: outcomeForWinner(winnerSeat, perspectiveSeat), perspectiveSeat };
  }
  if (flags.timeoutSeat !== null) {
    const winnerSeat = flags.timeoutSeat ^ 1;
    return { status: "RESOLVED", trigger: "TIMEOUT", tiebreak: "NONE", cause: "RUNTIME_TIMEOUT",
      winnerSeat, outcome: outcomeForWinner(winnerSeat, perspectiveSeat), perspectiveSeat };
  }
  const crashed = state.tanks.filter(tank => tank.crashed);
  if (crashed.length === 1) {
    const winnerSeat = crashed[0].seat ^ 1;
    return { status: "RESOLVED", trigger: "CRASH", tiebreak: "SURVIVOR", cause: "SINGLE_CRASH",
      winnerSeat, outcome: outcomeForWinner(winnerSeat, perspectiveSeat), perspectiveSeat };
  }
  if (crashed.length === 2) return tiebreak(state, context, "CRASH", "MUTUAL_CRASH_STAR",
    "MUTUAL_CRASH_RUNTIME", perspectiveSeat);
  if (state.recordIndex >= context.constants.frameRecordLimit - 1) return tiebreak(state, context,
    "FRAME_LIMIT", "FRAME_LIMIT_STAR", "FRAME_LIMIT_RUNTIME", perspectiveSeat);
  return { status: "RESOLVED", trigger: "NONE", tiebreak: "NONE", cause: null,
    winnerSeat: null, outcome: "NON_TERMINAL", perspectiveSeat };
}

function timeoutBoundary(runtimeMs, context) {
  if (!Number.isSafeInteger(runtimeMs) || runtimeMs < 0) throw new TypeError("runtimeMs invalid");
  const boundary = context.constants.runtimeTimeoutMs;
  if (runtimeMs < boundary) return "NOT_TIMEOUT";
  if (runtimeMs > boundary) return "TIMEOUT";
  const variant = requireVariant(context, "TIMEOUT_COMPARATOR_V1", "R0-TERMINAL-PRIORITY");
  return variant === "GE_3000_MS" ? "TIMEOUT" : "NOT_TIMEOUT";
}

module.exports = { outcomeForWinner, exactTieResolution, tiebreak, resolve, timeoutBoundary };
