/* Agent Chess — static evaluation.
 *
 * Material + piece-square tables (the classic "simplified evaluation"
 * tables) plus a few hand written positional terms: bishop pair, rook on
 * open file, doubled / isolated / passed pawns, king shield and tempo.
 *
 * Scores are centipawns from the side-to-move perspective, which is what
 * negamax wants.
 */
(function (AC) {
  'use strict';

  const C = AC.C;

  // Tables are written rank 8 -> rank 1, file a -> h, like a printed board.
  const RAW = {
    1: [ // pawn
       0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5, 5, 10, 25, 25, 10, 5, 5,
       0, 0, 0, 20, 20, 0, 0, 0,
       5, -5, -10, 0, 0, -10, -5, 5,
       5, 10, 10, -20, -20, 10, 10, 5,
       0, 0, 0, 0, 0, 0, 0, 0
    ],
    2: [ // knight
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    3: [ // bishop
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    4: [ // rook
       0, 0, 0, 0, 0, 0, 0, 0,
       5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
       0, 0, 0, 5, 5, 0, 0, 0
    ],
    5: [ // queen
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
       -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    6: [ // king middlegame
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
       20, 20, 0, 0, 0, 0, 20, 20,
       20, 30, 10, 0, 0, 10, 30, 20
    ]
  };

  const KING_END = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
  ];

  const PST = {};
  for (const key of Object.keys(RAW)) {
    const raw = RAW[key];
    const table = new Int16Array(64);
    for (let sq = 0; sq < 64; sq++) table[sq] = raw[63 - sq];
    PST[key] = table;
  }
  const KING_END_PST = new Int16Array(64);
  for (let sq = 0; sq < 64; sq++) KING_END_PST[sq] = KING_END[63 - sq];

  const PASSED_BONUS = [0, 5, 12, 22, 38, 62, 100, 0];

  const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = C;

  function evaluateWhite(s) {
    const board = s.board;
    const pawnFiles = [new Int8Array(8), new Int8Array(8)];
    const bishopCount = [0, 0];
    const kingSq = [s.kings[0], s.kings[1]];

    let phaseUnits = 0;

    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      const white = p > 0;
      const type = white ? p : -p;
      const side = white ? 0 : 1;

      if (type === PAWN) pawnFiles[side][sq & 7]++;
      else if (type === KNIGHT) phaseUnits += 1;
      else if (type === BISHOP) { phaseUnits += 1; bishopCount[side]++; }
      else if (type === ROOK) phaseUnits += 2;
      else if (type === QUEEN) phaseUnits += 4;
    }

    const phase = Math.min(1, phaseUnits / 24);
    let score = 0;

    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      const white = p > 0;
      const type = white ? p : -p;
      const rel = white ? sq : (sq ^ 56);
      const sign = white ? 1 : -1;

      score += sign * C.VALUE[type];

      if (type === KING) {
        const mg = PST[KING][rel];
        const eg = KING_END_PST[rel];
        score += sign * Math.round(mg * phase + eg * (1 - phase));
        continue;
      }

      score += sign * PST[type][rel];

      const file = sq & 7;
      const rank = sq >> 3;
      const relRank = white ? rank : 7 - rank;

      if (type === PAWN) {
        // doubled
        if (pawnFiles[white ? 0 : 1][file] > 1) score -= sign * 12;
        // isolated
        const left = file > 0 ? pawnFiles[white ? 0 : 1][file - 1] : 0;
        const right = file < 7 ? pawnFiles[white ? 0 : 1][file + 1] : 0;
        if (!left && !right) score -= sign * 14;
        // passed
        const enemy = pawnFiles[white ? 1 : 0];
        let blocked = false;
        for (let df = -1; df <= 1; df++) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          if (enemy[f] > 0) {
            // any enemy pawn on that file that is still ahead of us?
            for (let esq = 0; esq < 64; esq++) {
              const ep = board[esq];
              if (!ep || (ep > 0) === white) continue;
              if ((ep > 0 ? ep : -ep) !== PAWN) continue;
              if ((esq & 7) !== f) continue;
              const erank = white ? (esq >> 3) : 7 - (esq >> 3);
              if (erank > relRank) { blocked = true; break; }
            }
            if (blocked) break;
          }
        }
        if (!blocked) score += sign * PASSED_BONUS[relRank];
      } else if (type === ROOK) {
        const own = pawnFiles[white ? 0 : 1];
        const opp = pawnFiles[white ? 1 : 0];
        if (own[file] === 0) score += sign * (opp[file] === 0 ? 18 : 9);
      }
    }

    if (bishopCount[0] >= 2) score += 30;
    if (bishopCount[1] >= 2) score -= 30;

    // King shield, middlegame only.
    if (phase > 0.45) {
      for (let side = 0; side < 2; side++) {
        const k = kingSq[side];
        if (k < 0) continue;
        const kf = k & 7;
        const kr = k >> 3;
        const dir = side === 0 ? 1 : -1;
        let shield = 0;
        for (let df = -1; df <= 1; df++) {
          const f = kf + df;
          if (f < 0 || f > 7) continue;
          const sq = (kr + dir) * 8 + f;
          if (sq < 0 || sq > 63) continue;
          const p = board[sq];
          if (p && (p > 0 ? PAWN : -PAWN) === (side === 0 ? PAWN : -PAWN)) shield += 10;
        }
        score += side === 0 ? shield * phase : -shield * phase;
      }
    }

    score += s.turn === 1 ? 8 : -8;
    return score;
  }

  function evaluate(s) {
    const white = evaluateWhite(s);
    return s.turn === 1 ? white : -white;
  }

  AC.Eval = { evaluate, evaluateWhite, PST, KING_END_PST };
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
