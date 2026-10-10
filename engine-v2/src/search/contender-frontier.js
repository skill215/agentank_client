"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");

const FRONTIER_STATUS = Object.freeze({ NONE: 0, OPEN: 1, VALUE_RESOLVED: 2,
  ACTION_RESOLVED: 3 });

// Fixed-memory root branch-and-bound support.  Bounds are always for one
// target depth; shallow heuristic values are used only to order work and can
// never eliminate a row.
class ContenderFrontier {
  constructor() {
    const rows = SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    this.rowOrder = new Uint8Array(rows);
    this.columnOrder = new Uint8Array(rows * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rowLower = new Int32Array(rows); this.rowUpper = new Int32Array(rows);
    this.worstCompletedResponse = new Uint8Array(rows);
    this.unresolvedResponseCount = new Uint8Array(rows);
    this.member = new Uint8Array(rows);
    this.rowCount = 0; this.columnCount = 0; this.memberCount = 0;
    this.bestLower = -32000; this.rootUpper = 32000;
    this.provenRow = 255; this.provenValue = -32000;
    this.status = FRONTIER_STATUS.NONE; this.hotAllocationCount = 0;
  }
  prepareOrder(rootScore, rootCellScore, rowCount, columnCount,
      preferredRow = 255, preferredColumn = 255) {
    this.rowCount = rowCount; this.columnCount = columnCount;
    for (let row = 0; row < rowCount; row += 1) this.rowOrder[row] = row;
    for (let index = 1; index < rowCount; index += 1) {
      const row = this.rowOrder[index]; const score = rootScore[row]; let at = index;
      while (at > 0) {
        const before = this.rowOrder[at - 1]; const beforeScore = rootScore[before];
        if (beforeScore > score || beforeScore === score && before < row) break;
        this.rowOrder[at] = before; at -= 1;
      }
      this.rowOrder[at] = row;
    }
    if (preferredRow < rowCount) {
      let at = 0;
      while (at < rowCount && this.rowOrder[at] !== preferredRow) at += 1;
      for (; at > 0; at -= 1) this.rowOrder[at] = this.rowOrder[at - 1];
      this.rowOrder[0] = preferredRow;
    }
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    for (let row = 0; row < rowCount; row += 1) {
      const base = row * stride;
      for (let column = 0; column < columnCount; column += 1)
        this.columnOrder[base + column] = column;
      for (let index = 1; index < columnCount; index += 1) {
        const column = this.columnOrder[base + index];
        const score = rootCellScore[base + column]; let at = index;
        while (at > 0) {
          const before = this.columnOrder[base + at - 1];
          const beforeScore = rootCellScore[base + before];
          if (beforeScore < score || beforeScore === score && before < column) break;
          this.columnOrder[base + at] = before; at -= 1;
        }
        this.columnOrder[base + at] = column;
      }
      if (row === preferredRow && preferredColumn < columnCount) {
        let at = 0;
        while (at < columnCount && this.columnOrder[base + at] !== preferredColumn) at += 1;
        for (; at > 0; at -= 1)
          this.columnOrder[base + at] = this.columnOrder[base + at - 1];
        this.columnOrder[base] = preferredColumn;
      }
    }
    return this.rowOrder[0];
  }
  actualRow(orderIndex) { return this.rowOrder[orderIndex]; }
  actualColumn(actualRow, orderIndex) {
    return this.columnOrder[actualRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + orderIndex];
  }
  canPrune(actualRow, currentUpper, incumbentValue, incumbentRow) {
    if (incumbentRow === 255) return 0;
    if (currentUpper < incumbentValue) return 1;
    // Stable full search chooses the lowest row on an exact tie.  A larger
    // row can stop at equality; a smaller row must finish in case it ties.
    return currentUpper === incumbentValue && actualRow > incumbentRow ? 1 : 0;
  }
  update(cellLower, cellUpper, rowCount = this.rowCount,
      columnCount = this.columnCount) {
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    let bestLower = -32000; let rootUpper = -32000;
    for (let row = 0; row < rowCount; row += 1) {
      const base = row * stride; let lower = 32000; let upper = 32000;
      let unresolved = 0; let worst = 255; let worstValue = 32001;
      for (let column = 0; column < columnCount; column += 1) {
        const at = base + column; const cellL = cellLower[at]; const cellU = cellUpper[at];
        if (cellL < lower) lower = cellL; if (cellU < upper) upper = cellU;
        if (cellL !== cellU) unresolved += 1;
        else if (cellU < worstValue) { worstValue = cellU; worst = column; }
      }
      this.rowLower[row] = lower; this.rowUpper[row] = upper;
      this.unresolvedResponseCount[row] = unresolved;
      this.worstCompletedResponse[row] = worst;
      if (lower > bestLower) bestLower = lower;
      if (upper > rootUpper) rootUpper = upper;
    }
    this.bestLower = bestLower; this.rootUpper = rootUpper; this.memberCount = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const member = this.rowUpper[row] >= bestLower ? 1 : 0;
      this.member[row] = member; this.memberCount += member;
    }
    this.provenRow = 255; this.provenValue = bestLower;
    for (let row = 0; row < rowCount; row += 1) {
      if (this.rowLower[row] !== this.rowUpper[row] || this.rowLower[row] !== bestLower) continue;
      let proven = 1;
      for (let other = 0; other < rowCount; other += 1) if (other !== row) {
        const allowedUpper = other < row ? bestLower - 1 : bestLower;
        if (this.rowUpper[other] > allowedUpper) { proven = 0; break; }
      }
      if (proven) { this.provenRow = row; break; }
    }
    this.status = this.provenRow !== 255 ? FRONTIER_STATUS.ACTION_RESOLVED :
      bestLower === rootUpper ? FRONTIER_STATUS.VALUE_RESOLVED : FRONTIER_STATUS.OPEN;
    return this.status;
  }
}

module.exports = { FRONTIER_STATUS, ContenderFrontier };
