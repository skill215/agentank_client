"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { CACHE_ID } = require("../abi/cache-runtime-codes");
const { TERRAIN, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

const PATH_UNREACHABLE = 0xffff;
const PATH_ALGORITHM_VERSION = 1;

// Materialized value for the registered PATH_CACHE id. One reverse BFS builds
// a complete distance field; every action query after that is O(1). The arrays
// are allocated once and reused across the match.
class PathDistanceField {
  constructor() {
    this.cacheId = CACHE_ID.PATH_CACHE; this.algorithmVersion = PATH_ALGORITHM_VERSION;
    this.distance = new Uint16Array(CAPACITY.MAX_CELLS);
    this.queue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.goal = NONE_CELL; this.topologyVersion = 0xffffffff; this.width = 0; this.height = 0;
    this.complete = 0;
    this.hotAllocationCount = 0; this.byteSize = this.distance.byteLength + this.queue.byteLength;
    this.distance.fill(PATH_UNREACHABLE);
  }
  invalidate() { this.goal = NONE_CELL; this.topologyVersion = 0xffffffff; this.complete = 0; }
  reset() { this.invalidate(); }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  walkable(state, cell) {
    if (cell === NONE_CELL) return 0; const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }
  prepare(state, goal, cacheEnabled = 1) {
    const topologyVersion = state.arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION];
    if (cacheEnabled && this.complete && this.goal === goal && this.width === state.width &&
        this.height === state.height && this.topologyVersion === topologyVersion) {
      return 1;
    }
    this.distance.fill(PATH_UNREACHABLE); this.goal = goal; this.width = state.width;
    this.height = state.height; this.topologyVersion = topologyVersion; this.complete = 0;
    if (!this.walkable(state, goal)) return 0;
    let head = 0; let tail = 0; this.queue[tail++] = goal; this.distance[goal] = 0;
    while (head < tail) {
      const cell = this.queue[head++]; const nextDistance = this.distance[cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.target(state, cell, direction);
        if (this.walkable(state, next) && this.distance[next] === PATH_UNREACHABLE) {
          this.distance[next] = nextDistance; this.queue[tail++] = next;
        }
      }
    }
    this.complete = 1; return tail + 1;
  }
  read(cell) { return this.complete && cell !== NONE_CELL ? this.distance[cell] : PATH_UNREACHABLE; }
  helpfulDirection(state, cell, direction, blocked = NONE_CELL) {
    const current = this.read(cell); const next = this.target(state, cell, direction);
    return current !== PATH_UNREACHABLE && next !== blocked && this.walkable(state, next) &&
      this.read(next) < current ? 1 : 0;
  }
}

module.exports = { PATH_UNREACHABLE, PATH_ALGORITHM_VERSION, PathDistanceField };
