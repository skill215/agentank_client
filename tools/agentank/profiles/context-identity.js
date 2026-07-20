"use strict";

const { invariant } = require("../core/errors");
const { assertBranch } = require("../core/paths");
const { SKILLS } = require("./registry");
const { sha256Text } = require("../core/hash");

function extractSkill(context) {
  const values = [context?.tank?.skillType, context?.skill?.type]
    .filter(value => typeof value === "string" && value.length > 0);
  invariant(values.length > 0, "PLATFORM_SKILL_MISSING", "platform context did not include a skill id");
  invariant(values.every(value => value === values[0]), "PLATFORM_SKILL_CONFLICT",
    "platform context returned conflicting skill ids");
  invariant(SKILLS.has(values[0]) && values[0] !== "UNKNOWN", "PLATFORM_SKILL_UNKNOWN",
    "platform context returned an unsupported skill id");
  return values[0];
}

function extractCodeCandidate(context, branch) {
  const candidates = [
    context?.codeBranches?.[branch],
    context?.branches?.[branch],
    context?.branchCode,
    context?.latestCode,
    context?.code
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return { code: candidate, version: null };
    if (!candidate || typeof candidate !== "object") continue;
    const code = typeof candidate.code === "string" ? candidate.code :
      typeof candidate.source === "string" ? candidate.source : null;
    if (code !== null) {
      const version = Number.isSafeInteger(candidate.version) ? candidate.version :
        Number.isSafeInteger(candidate.codeVersion) ? candidate.codeVersion : null;
      return { code, version };
    }
  }
  return { code: null, version: null };
}

function extractContextIdentity(context, branch = "main") {
  assertBranch(branch);
  const tankId = context?.tank?.id;
  invariant(Number.isSafeInteger(tankId), "PLATFORM_TANK_ID_MISSING",
    "platform context did not include an integer tank.id");
  const tankUrlId = context?.tank?.urlId || context?.tank?.tankUrlId || context?.tankUrlId || null;
  const skillId = extractSkill(context);
  const published = extractCodeCandidate(context, branch);
  return {
    tankId,
    tankName: typeof context?.tank?.name === "string" ? context.tank.name : null,
    tankUrlId,
    skillId,
    branch,
    publishedVersion: published.version,
    publishedCodeHash: published.code === null ? null : sha256Text(published.code),
    baselineStatus: published.code === null ? (branch === "main" ? "UNPUBLISHED" : "UNKNOWN") :
      "VERIFIED_BASELINE"
  };
}

function verifyProfileIdentity(profile, identity, options = {}) {
  const allowBootstrap = options.allowBootstrap === true && profile.status === "BOOTSTRAP";
  if (!allowBootstrap || profile.tankId !== null) {
    invariant(profile.tankId === identity.tankId, "TANK_IDENTITY_MISMATCH",
      "TankProfile tankId does not match platform context");
  }
  if (!allowBootstrap || profile.skillId !== "UNKNOWN") {
    invariant(profile.skillId === identity.skillId, "TANK_SKILL_MISMATCH",
      "TankProfile skill does not match platform context");
  }
  if (!allowBootstrap || profile.tankUrlId !== null) {
    invariant(profile.tankUrlId === identity.tankUrlId, "TANK_URL_IDENTITY_MISMATCH",
      "TankProfile tankUrlId does not match platform context");
  }
  if (Array.isArray(profile.branches)) {
    const branch = profile.branches.find(item => item.branch === identity.branch);
    invariant(branch || allowBootstrap, "TANK_BRANCH_MISMATCH",
      "TankProfile does not contain the requested platform branch");
  }
  return true;
}

module.exports = { extractSkill, extractCodeCandidate, extractContextIdentity, verifyProfileIdentity };
