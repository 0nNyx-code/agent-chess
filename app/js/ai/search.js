/* Agent Chess — negamax search with alpha-beta, PVS, quiescence, a
 * transposition table, killers/history ordering and null-move pruning.
 *
 * Runs on the main thread or inside a Web Worker; it only depends on
 * AC.Engine and AC.Eval.
 */
(function (AC) {
  'use strict';

  const C = AC.C;
  const E = AC.Engine;
  const MATE = C.MATE;
  const INF = C.INF;
  const ABORT = { abort: true };

  const LEVELS = {
    easy: { depth: 2, timeMs: 240, margin: 150, label: 'Easy' },
    medium: { depth: 4, timeMs: 750, margin: 45, label: 'Medium' },
    hard: { depth: 6, timeMs: 1700, margin: 14, label: 'Hard' },
    expert: { depth: 9, timeMs: 3400, margin: 0, label: 'Expert' }
  };

  const TT_EXACT = 0;
  const TT_LOWER = 1;
  const TT_UPPER = 2;

  function Searcher() {
    this.tt = new Map();
    this.killers = [];
    this.history = new Int32Array(13 * 64);
    this.nodes = 0;
    this.deadline = 0;
    this.path = [];
  }

  Searcher.prototype.resetHeuristics = function () {
    this.killers = [];
    this.history.fill(0);
  };

  Searcher.prototype.toTT = function (score, ply) {
    if (score > MATE - 1000) return score + ply;
    if (score < -MATE + 1000) return score - ply;
    return score;
  };

  Searcher.prototype.fromTT = function (score, ply) {
    if (score > MATE - 1000) return score - ply;
    if (score < -MATE + 1000) return score + ply;
    return score;
  };

  Searcher.prototype.hasNonPawn = function (s, side) {
    const board = s.board;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || (p > 0 ? 1 : -1) !== side) continue;
      const type = p > 0 ? p : -p;
      if (type !== C.PAWN && type !== C.KING) return true;
    }
    return false;
  };

  Searcher.prototype.isRepetition = function (s, ply) {
    const limit = Math.max(0, ply - s.half - 1);
    for (let i = ply - 2; i >= limit; i -= 2) {
      if (this.path[i] === s.hash) return true;
    }
    return false;
  };

  Searcher.prototype.orderMoves = function (s, moves, ttMove, ply) {
    const n = moves.length;
    if (n < 2) return;
    const scores = new Int32Array(n);
    const killers = this.killers[ply];

    for (let i = 0; i < n; i++) {
      const m = moves[i];
      let sc = 0;
      if (m === ttMove) {
        sc = 1e9;
      } else {
        const to = (m >> 6) & 63;
        const flags = m >> 15;
        let victim = s.board[to];
        if (flags & C.F_EP) victim = s.turn === 1 ? -1 : 1;
        if (victim) {
          const attacker = s.board[m & 63];
          sc = 1e6 + C.VALUE[victim > 0 ? victim : -victim] * 16 -
            C.VALUE[attacker > 0 ? attacker : -attacker];
        } else if ((m >> 12) & 7) {
          sc = 9e5 + C.VALUE[(m >> 12) & 7];
        } else if (killers && m === killers[0]) {
          sc = 8e5;
        } else if (killers && m === killers[1]) {
          sc = 7e5;
        } else {
          const p = s.board[m & 63];
          sc = this.history[(p + 6) * 64 + to] || 0;
        }
      }
      scores[i] = sc;
    }

    for (let i = 1; i < n; i++) {
      const m = moves[i];
      const sc = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < sc) {
        moves[j + 1] = moves[j];
        scores[j + 1] = scores[j];
        j--;
      }
      moves[j + 1] = m;
      scores[j + 1] = sc;
    }
  };

  Searcher.prototype.quiesce = function (s, alpha, beta, ply, qdepth) {
    this.nodes++;
    if ((this.nodes & 511) === 0 && Date.now() >= this.deadline) throw ABORT;
    if (qdepth > 10) return AC.Eval.evaluate(s);

    const inChk = E.inCheck(s, s.turn);

    if (inChk) {
      const moves = E.generateMoves(s);
      if (!moves.length) return -MATE + ply;
      this.orderMoves(s, moves, 0, ply);
      let best = -INF;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const undo = E.makeMove(s, m);
        this.path[ply + 1] = s.hash;
        let score;
        try {
          score = -this.quiesce(s, -beta, -alpha, ply + 1, qdepth + 1);
        } finally {
          E.unmakeMove(s, undo);
        }
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) return beta;
      }
      return best;
    }

    const stand = AC.Eval.evaluate(s);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    const caps = E.generateCaptures(s);
    this.orderMoves(s, caps, 0, ply);
    for (let i = 0; i < caps.length; i++) {
      const m = caps[i];
      const undo = E.makeMove(s, m);
      this.path[ply + 1] = s.hash;
      let score;
      try {
        score = -this.quiesce(s, -beta, -alpha, ply + 1, qdepth + 1);
      } finally {
        E.unmakeMove(s, undo);
      }
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  Searcher.prototype.negamax = function (s, depth, alpha, beta, ply, allowNull) {
    this.nodes++;
    if ((this.nodes & 511) === 0 && Date.now() >= this.deadline) throw ABORT;
    if (ply > 0 && this.isRepetition(s, ply)) return 0;

    const inChk = E.inCheck(s, s.turn);
    if (depth <= 0) return this.quiesce(s, alpha, beta, ply, 0);

    const key = s.hash;
    const entry = this.tt.get(key);
    let ttMove = 0;
    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        const sc = this.fromTT(entry.score, ply);
        if (entry.flag === TT_EXACT) return sc;
        if (entry.flag === TT_LOWER && sc >= beta) return sc;
        if (entry.flag === TT_UPPER && sc <= alpha) return sc;
      }
    }

    if (allowNull && !inChk && depth >= 3 && ply > 0 && this.hasNonPawn(s, s.turn)) {
      const savedEp = s.ep;
      const savedHash = s.hash;
      s.turn = -s.turn;
      s.ep = -1;
      let h = savedHash ^ C.Z.side;
      if (savedEp >= 0) h ^= C.Z.ep[savedEp & 7];
      s.hash = h >>> 0;
      let score;
      try {
        score = -this.negamax(s, depth - 3, -beta, -beta + 1, ply + 1, false);
      } finally {
        s.turn = -s.turn;
        s.ep = savedEp;
        s.hash = savedHash;
      }
      if (score >= beta) return beta;
    }

    const moves = E.generateMoves(s);
    if (!moves.length) return inChk ? -MATE + ply : 0;

    this.orderMoves(s, moves, ttMove, ply);

    const origAlpha = alpha;
    let best = 0;
    let bestScore = -INF;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const undo = E.makeMove(s, m);
      this.path[ply + 1] = s.hash;
      let score;

      try {
        if (i === 0) {
          score = -this.negamax(s, depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          let reduction = 0;
          if (depth >= 3 && i >= 4 && !inChk &&
              !E.isCapture(s, m) && !E.isPromotion(m)) {
            reduction = 1;
          }
          score = -this.negamax(s, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
          if (score > alpha && reduction) {
            score = -this.negamax(s, depth - 1, -alpha - 1, -alpha, ply + 1, true);
          }
          if (score > alpha && score < beta) {
            score = -this.negamax(s, depth - 1, -beta, -alpha, ply + 1, true);
          }
        }
      } finally {
        E.unmakeMove(s, undo);
      }

      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
      if (score > alpha) alpha = score;

      if (alpha >= beta) {
        if (!E.isCapture(s, m)) {
          const k = this.killers[ply] || (this.killers[ply] = [0, 0]);
          if (k[0] !== m) {
            k[1] = k[0];
            k[0] = m;
          }
          const p = s.board[m & 63];
          this.history[(p + 6) * 64 + ((m >> 6) & 63)] += depth * depth;
        }
        break;
      }
    }

    let flag = TT_EXACT;
    if (bestScore <= origAlpha) flag = TT_UPPER;
    else if (bestScore >= beta) flag = TT_LOWER;

    if (!entry || entry.depth <= depth) {
      this.tt.set(key, {
        depth,
        score: this.toTT(bestScore, ply),
        flag,
        move: best
      });
      if (this.tt.size > 160000) this.tt.clear();
    }

    return bestScore;
  };

  Searcher.prototype.searchRoot = function (s, depth, prevBest) {
    const moves = E.generateMoves(s);
    if (!moves.length) return { move: 0, score: -MATE, scores: [] };

    this.orderMoves(s, moves, prevBest, 0);

    let alpha = -INF;
    const beta = INF;
    let best = moves[0];
    let bestScore = -INF;
    const scores = new Array(moves.length);

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const undo = E.makeMove(s, m);
      this.path[1] = s.hash;
      let score;
      try {
        score = -this.negamax(s, depth - 1, -beta, -alpha, 1, true);
      } finally {
        E.unmakeMove(s, undo);
      }
      scores[i] = { move: m, score };
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
      if (score > alpha) alpha = score;
    }

    return { move: best, score: bestScore, scores };
  };

  Searcher.prototype.findBestMove = function (state, opts) {
    opts = opts || {};
    const level = LEVELS[opts.level] || LEVELS.medium;
    const maxDepth = opts.depth || level.depth;
    const timeMs = opts.timeMs || level.timeMs;
    const margin = opts.margin !== undefined ? opts.margin : level.margin;

    const s = E.clone(state);
    this.nodes = 0;
    this.deadline = Date.now() + timeMs;
    this.path = new Array(maxDepth + 32).fill(0);
    this.path[0] = s.hash;
    this.resetHeuristics();

    let best = 0;
    let bestScore = 0;
    let completed = 0;
    let rootScores = [];
    const started = Date.now();

    for (let depth = 1; depth <= maxDepth; depth++) {
      try {
        const result = this.searchRoot(s, depth, best);
        if (result.move) {
          best = result.move;
          bestScore = result.score;
          rootScores = result.scores;
          completed = depth;
          if (opts.onInfo) {
            opts.onInfo({ depth, score: bestScore, nodes: this.nodes, move: best });
          }
        }
      } catch (err) {
        if (err !== ABORT) throw err;
        break;
      }
      if (Math.abs(bestScore) > MATE - 1000) break;
      if (Date.now() >= this.deadline) break;
    }

    let chosen = best;
    if (margin > 0 && rootScores.length > 1) {
      const safe = rootScores.filter((x) => x.score > -MATE + 1000);
      const pool = safe.length ? safe : rootScores;
      const top = pool.filter((x) => x.score >= bestScore - margin);
      if (top.length > 1) {
        chosen = top[Math.floor(Math.random() * top.length)].move;
      }
    }

    if (!chosen) {
      const moves = E.generateMoves(s);
      if (moves.length) chosen = moves[Math.floor(Math.random() * moves.length)];
    }

    return {
      move: chosen,
      best: best,
      score: bestScore,
      depth: completed,
      nodes: this.nodes,
      timeMs: Date.now() - started
    };
  };

  function findBestMove(state, opts) {
    return new Searcher().findBestMove(state, opts);
  }

  AC.Search = {
    LEVELS,
    Searcher,
    findBestMove
  };
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
