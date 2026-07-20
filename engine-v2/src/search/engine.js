"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { SEARCH_STATUS, NODE_KIND, PROOF_GOAL, PROOF_STATUS, PROOF_MODE,
  POLICY_FLAG, NONE_NODE, PROBABILITY_SCALE } = require("../abi/search-codes");
const { ValueSearch } = require("./value-search");
const { ProofSearch } = require("./proof-search");
const { StageMatrix, DoubleOracleSolver } = require("./matrix");
const { PolicyArena, CoverageArena } = require("./arenas");

class SearchEngine {
  constructor(graph, options = {}) {
    this.graph = graph; this.policyArena = options.policyArena || new PolicyArena();
    this.coverageArena = options.coverageArena || new CoverageArena();
    this.value = new ValueSearch(graph, options); this.proof = new ProofSearch(graph, this.coverageArena);
    this.matrix = new StageMatrix(); this.matrixSolver = new DoubleOracleSolver(this.matrix, this.policyArena);
    this.proofActions = new Uint16Array(1); this.proofProbability = new Uint16Array(1);
    this.lastStatus = SEARCH_STATUS.INCOMPLETE; this.lastPolicyHandle = NONE_NODE;
    this.lastProofStatus = PROOF_STATUS.UNKNOWN; this.lastRoot = NONE_NODE;
    this.strictFingerprintLo = 0; this.strictFingerprintHi = 0; this.hotAllocationCount = 0;
  }
  loadMatrix(node) {
    const rows = this.graph.rows[node]; const columns = this.graph.columns[node];
    if (this.matrix.initialize(rows, columns) !== SEARCH_STATUS.COMPLETE) return SEARCH_STATUS.CAPACITY;
    const start = this.graph.edgeStart[node];
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const child = this.graph.edgeChild[start + row * columns + column];
      if (this.matrix.setCell(row, column, this.value.lower[child], this.value.upper[child],
          this.value.complete[child]) !== SEARCH_STATUS.COMPLETE) return SEARCH_STATUS.INVALID;
    }
    return SEARCH_STATUS.COMPLETE;
  }
  proofWinningRow(node) {
    if (this.graph.kind[node] === NODE_KIND.OUR_DECISION) {
      const start = this.graph.edgeStart[node]; const count = this.graph.edgeCount[node];
      for (let row = 0; row < count; row += 1)
        if (this.proof.status[this.graph.edgeChild[start + row]] === PROOF_STATUS.PROVEN) return row;
      return NONE_NODE;
    }
    if (this.graph.kind[node] !== NODE_KIND.SIMULTANEOUS) return NONE_NODE;
    const rows = this.graph.rows[node]; const columns = this.graph.columns[node];
    const start = this.graph.edgeStart[node];
    for (let row = 0; row < rows; row += 1) {
      let all = 1; for (let column = 0; column < columns; column += 1)
        if (this.proof.status[this.graph.edgeChild[start + row * columns + column]] !==
            PROOF_STATUS.PROVEN) all = 0;
      if (all) return row;
    }
    return NONE_NODE;
  }
  solveRoot(root, options = {}) {
    const nodeBudget = options.nodeBudget ?? SEARCH_CAPACITY.MAX_NODES;
    const proofBudget = options.proofBudget ?? SEARCH_CAPACITY.MAX_NODES;
    const iterations = options.matrixIterations ?? 128; let baseRisk = options.baseRisk ?? 0;
    let enemyNominalProbability = options.enemyNominalProbability || null;
    this.lastRoot = root; this.lastPolicyHandle = NONE_NODE;
    this.lastProofStatus = this.proof.solve(root, PROOF_GOAL.FORCED_WIN, proofBudget,
      options.proofMode ?? PROOF_MODE.AND_OR_DFS);
    this.strictFingerprintLo = this.proof.traceLo; this.strictFingerprintHi = this.proof.traceHi;
    if (this.lastProofStatus === PROOF_STATUS.PROVEN) {
      const action = this.proofWinningRow(root); if (action !== NONE_NODE) {
        this.proofActions[0] = action; this.proofProbability[0] = PROBABILITY_SCALE;
        this.lastPolicyHandle = this.policyArena.write(this.proofActions, this.proofProbability, 1,
          POLICY_FLAG.DETERMINISTIC | POLICY_FLAG.PROVEN);
        if (this.lastPolicyHandle === NONE_NODE) {
          this.lastStatus = SEARCH_STATUS.CAPACITY; return this.lastStatus;
        }
      }
      this.lastStatus = SEARCH_STATUS.COMPLETE; return this.lastStatus;
    }
    if (options.policyLayer) {
      const decision = options.policyLayer.prepareSearch(options.policyFeatureInput,
        options.policyStrategyInput, options.globalMode, options.policyAction, options.policyPlanKind);
      if (options.baseRisk === undefined) baseRisk = decision.baseRisk;
      if (!enemyNominalProbability && options.enemyActionFamilies && options.enemyActionCount) {
        const count = decision.opponent.buildNominalPolicy(options.enemyActionFamilies,
          options.enemyActionCount, options.enemyContextClass || 0, decision.enemyProbability);
        if (count === options.enemyActionCount) enemyNominalProbability = decision.enemyProbability;
      }
    }
    const valueStatus = this.value.solve(root, nodeBudget, baseRisk);
    if (valueStatus === SEARCH_STATUS.INVALID) {
      this.lastStatus = valueStatus; return this.lastStatus;
    }
    if (this.graph.kind[root] !== NODE_KIND.SIMULTANEOUS ||
        this.loadMatrix(root) !== SEARCH_STATUS.COMPLETE) {
      this.lastStatus = valueStatus; return this.lastStatus;
    }
    if (enemyNominalProbability) {
      const riskStatus = this.value.risk.transformEnemyMatrix(this.matrix,
        enemyNominalProbability, baseRisk, this.graph.riskClass[root]);
      if (riskStatus !== SEARCH_STATUS.COMPLETE) {
        this.lastStatus = SEARCH_STATUS.INCOMPLETE; return this.lastStatus;
      }
    }
    this.lastStatus = this.matrixSolver.solve(iterations, options.matrixBatch ?? 16,
      options.matrixExpansions ?? SEARCH_CAPACITY.MAX_DOUBLE_ORACLE_EXPANSIONS);
    this.lastPolicyHandle = this.matrixSolver.policyHandle; return this.lastStatus;
  }
}

module.exports = { SearchEngine };
