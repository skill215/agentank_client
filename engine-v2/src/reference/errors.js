"use strict";

class ReferenceRuleError extends Error {
  constructor(code, ruleId, message, details = null) {
    super(message); this.name = "ReferenceRuleError"; this.code = code; this.ruleId = ruleId;
    this.details = details;
  }
}

function requireVariant(context, groupId, ruleId) {
  const selected = context.activeVariantByGroup[groupId];
  if (selected !== null && selected !== undefined) return selected;
  throw new ReferenceRuleError("REFERENCE_VARIANT_REQUIRED", ruleId,
    `rule variant ${groupId} must be selected`, { variantGroupId: groupId });
}

function unknownRule(ruleId, message, details = null) {
  throw new ReferenceRuleError("REFERENCE_UNKNOWN_RULE", ruleId, message, details);
}

module.exports = { ReferenceRuleError, requireVariant, unknownRule };
