"use strict";

const { fingerprintObject } = require("../core/hash");

const ANALYSIS_OUTCOME = Object.freeze({ V1_WIN: "V1_WIN", V2_WIN: "V2_WIN", DRAW: "DRAW" });
const TERMINAL_CATEGORY = Object.freeze({
  SINGLE_CRASH: "SINGLE_CRASH",
  MUTUAL_CRASH_STARS: "MUTUAL_CRASH_STARS",
  MUTUAL_CRASH_EQUAL_STARS: "MUTUAL_CRASH_EQUAL_STARS",
  FRAME_LIMIT_STARS: "FRAME_LIMIT_STARS",
  FRAME_LIMIT_EQUAL_STARS: "FRAME_LIMIT_EQUAL_STARS",
  RAW_DRAW: "RAW_DRAW",
  RAW_FALLBACK: "RAW_FALLBACK"
});

function winnerOutcome(match, seat) {
  if (seat !== 0 && seat !== 1) return ANALYSIS_OUTCOME.DRAW;
  return match.seatImplementations?.[seat] === "v2" ?
    ANALYSIS_OUTCOME.V2_WIN : ANALYSIS_OUTCOME.V1_WIN;
}

function classifyAnalysisOutcome(match) {
  const raw = match?.result || {}; const stars = match?.counts?.stars || [0, 0];
  const crashes = match?.counts?.crashes || [0, 0];
  const equalStars = stars[0] === stars[1]; const mutualCrash = crashes[0] > 0 && crashes[1] > 0;
  let analysisOutcome; let terminalCategory;
  if (raw.reason === "frameLimit") {
    analysisOutcome = equalStars ? ANALYSIS_OUTCOME.DRAW : winnerOutcome(match, stars[0] > stars[1] ? 0 : 1);
    terminalCategory = equalStars ? TERMINAL_CATEGORY.FRAME_LIMIT_EQUAL_STARS :
      TERMINAL_CATEGORY.FRAME_LIMIT_STARS;
  } else if (mutualCrash) {
    analysisOutcome = equalStars ? ANALYSIS_OUTCOME.DRAW : winnerOutcome(match, stars[0] > stars[1] ? 0 : 1);
    terminalCategory = equalStars ? TERMINAL_CATEGORY.MUTUAL_CRASH_EQUAL_STARS :
      TERMINAL_CATEGORY.MUTUAL_CRASH_STARS;
  } else if (crashes[0] > 0 || crashes[1] > 0) {
    analysisOutcome = winnerOutcome(match, crashes[0] > 0 ? 1 : 0);
    terminalCategory = TERMINAL_CATEGORY.SINGLE_CRASH;
  } else if (raw.winnerImplementation === "draw" || raw.winnerSeat == null) {
    analysisOutcome = ANALYSIS_OUTCOME.DRAW; terminalCategory = TERMINAL_CATEGORY.RAW_DRAW;
  } else {
    analysisOutcome = raw.winnerImplementation === "v2" ? ANALYSIS_OUTCOME.V2_WIN :
      ANALYSIS_OUTCOME.V1_WIN; terminalCategory = TERMINAL_CATEGORY.RAW_FALLBACK;
  }
  return Object.freeze({ analysisOutcome, terminalCategory,
    rawWinnerImplementation: raw.winnerImplementation ?? null,
    rawWinnerSeat: raw.winnerSeat ?? null, rawReason: raw.reason ?? null,
    stars: Object.freeze([stars[0] || 0, stars[1] || 0]),
    crashes: Object.freeze([crashes[0] || 0, crashes[1] || 0]) });
}

function analysisFingerprint(match) {
  return fingerprintObject({ matchId: match.matchId, result: match.result,
    counts: { stars: match.counts?.stars, crashes: match.counts?.crashes },
    seatImplementations: match.seatImplementations });
}

function pairCategory(left, right) {
  const outcomes = [left.analysisOutcome, right.analysisOutcome].sort();
  if (outcomes[0] === ANALYSIS_OUTCOME.V2_WIN && outcomes[1] === ANALYSIS_OUTCOME.V2_WIN)
    return "V2_SWEEP";
  if (outcomes[0] === ANALYSIS_OUTCOME.V1_WIN && outcomes[1] === ANALYSIS_OUTCOME.V1_WIN)
    return "V1_SWEEP";
  if (outcomes.includes(ANALYSIS_OUTCOME.V1_WIN) && outcomes.includes(ANALYSIS_OUTCOME.V2_WIN))
    return "SPLIT";
  if (outcomes.includes(ANALYSIS_OUTCOME.V2_WIN)) return "V2_WIN_DRAW";
  if (outcomes.includes(ANALYSIS_OUTCOME.V1_WIN)) return "V1_WIN_DRAW";
  return "DOUBLE_DRAW";
}

module.exports = { ANALYSIS_OUTCOME, TERMINAL_CATEGORY, classifyAnalysisOutcome,
  analysisFingerprint, pairCategory };
