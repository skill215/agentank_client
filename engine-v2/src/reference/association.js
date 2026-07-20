"use strict";

const { signature } = require("./state");

function sameExternalKey(left, right) {
  return left?.status === "FIELD_PRESENT" && right?.status === "FIELD_PRESENT" &&
    left.lo === right.lo && left.hi === right.hi;
}
function sameCell(left, right) { return left[0] === right[0] && left[1] === right[1]; }

function projectileCanAssociate(observed, tracked, frameGap) {
  if (observed.ownerSeat !== tracked.ownerSeat || observed.direction !== tracked.direction) return false;
  if (sameExternalKey(observed.externalKey, tracked.externalKey)) return true;
  const dx = observed.cell[0] - tracked.cell[0];
  const dy = observed.cell[1] - tracked.cell[1];
  const signed = tracked.direction === "right" ? dx : tracked.direction === "left" ? -dx :
    tracked.direction === "down" ? dy : -dy;
  const lateral = tracked.direction === "right" || tracked.direction === "left" ? dy : dx;
  return lateral === 0 && signed >= 0 && signed <= frameGap * 2;
}

function bombCanAssociate(observed, tracked) {
  if (sameExternalKey(observed.externalKey, tracked.externalKey)) return true;
  return sameCell(observed.cell, tracked.cell) && observed.explodeInterval[0] <= tracked.explodeFrame &&
    observed.explodeInterval[1] >= tracked.explodeFrame;
}

function associateEntities(observed, tracked, kind, frameGap = 0) {
  const canAssociate = kind === "projectile" ?
    (left, right) => projectileCanAssociate(left, right, frameGap) : bombCanAssociate;
  const candidatesByObservation = observed.map((item, observedIndex) => ({ observedIndex,
    trackedIndices: tracked.map((candidate, trackedIndex) => canAssociate(item, candidate) ? trackedIndex : -1)
      .filter(index => index >= 0) }));
  const associatedTracked = new Set(candidatesByObservation.flatMap(item => item.trackedIndices));
  const relations = candidatesByObservation.map(item => ({ ...item,
    status: item.trackedIndices.length === 0 ? "OBSERVED_NEW_ENTITY" :
      item.trackedIndices.length === 1 ? "ASSOCIATED_EXACT" : "ASSOCIATED_AMBIGUOUS" }));
  for (let trackedIndex = 0; trackedIndex < tracked.length; trackedIndex += 1) {
    if (!associatedTracked.has(trackedIndex)) relations.push({ observedIndex: null,
      trackedIndices: [trackedIndex], status: "PREDICTED_HIDDEN" });
  }
  return { kind, complete: true, relations,
    ambiguous: relations.some(item => item.status === "ASSOCIATED_AMBIGUOUS"),
    relationSignature: signature({ kind, relations }) };
}

function enumerateAssignments(relation, limit = 256) {
  const observedRelations = relation.relations.filter(item => item.observedIndex !== null);
  const output = [];
  function visit(index, used, assignment) {
    if (output.length >= limit) return;
    if (index === observedRelations.length) { output.push([...assignment]); return; }
    const item = observedRelations[index];
    if (item.trackedIndices.length === 0) {
      assignment.push({ observedIndex: item.observedIndex, trackedIndex: null });
      visit(index + 1, used, assignment); assignment.pop(); return;
    }
    for (const trackedIndex of item.trackedIndices) {
      if (used.has(trackedIndex)) continue;
      used.add(trackedIndex); assignment.push({ observedIndex: item.observedIndex, trackedIndex });
      visit(index + 1, used, assignment); assignment.pop(); used.delete(trackedIndex);
    }
  }
  visit(0, new Set(), []);
  return { assignments: output, complete: output.length < limit,
    incompleteReason: output.length >= limit ? "INCOMPLETE_ASSOCIATION_CAPACITY" : null };
}

module.exports = { sameExternalKey, projectileCanAssociate, bombCanAssociate, associateEntities,
  enumerateAssignments };
