/* Agent Chess — shared constants, geometry tables and Zobrist keys.
 * Classic script (no bundler, no framework). Attaches to window.AC.
 */
(function (AC) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const SQUARE_NAMES = [];
  for (let sq = 0; sq < 64; sq++) SQUARE_NAMES.push(FILES[sq & 7] + ((sq >> 3) + 1));

  const SQUARE_INDEX = Object.create(null);
  for (let i = 0; i < 64; i++) SQUARE_INDEX[SQUARE_NAMES[i]] = i;

  const KNIGHT_TARGETS = [];
  const KING_TARGETS = [];

  for (let sq = 0; sq < 64; sq++) {
    const f = sq & 7;
    const r = sq >> 3;
    KNIGHT_TARGETS[sq] = [];
    for (const d of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      const nf = f + d[0];
      const nr = r + d[1];
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KNIGHT_TARGETS[sq].push(nr * 8 + nf);
    }
    KING_TARGETS[sq] = [];
    for (const d of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]) {
      const nf = f + d[0];
      const nr = r + d[1];
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KING_TARGETS[sq].push(nr * 8 + nf);
    }
  }

  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const QUEEN_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);

  const CASTLE_WK = 1;
  const CASTLE_WQ = 2;
  const CASTLE_BK = 4;
  const CASTLE_BQ = 8;

  // Castling rights that survive a piece leaving / arriving on a square.
  const CASTLE_MASK = new Array(64).fill(15);
  CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);   // e1
  CASTLE_MASK[7] = 15 & ~CASTLE_WK;                 // h1
  CASTLE_MASK[0] = 15 & ~CASTLE_WQ;                 // a1
  CASTLE_MASK[60] = 15 & ~(CASTLE_BK | CASTLE_BQ);  // e8
  CASTLE_MASK[63] = 15 & ~CASTLE_BK;                // h8
  CASTLE_MASK[56] = 15 & ~CASTLE_BQ;                // a8

  // Move encoding: from | to<<6 | promo<<12 | flags<<15
  const F_EP = 1;
  const F_CASTLE = 2;
  const F_DOUBLE = 4;

  const mv = (from, to, promo, flags) =>
    (from | (to << 6) | ((promo || 0) << 12) | ((flags || 0) << 15));
  const mFrom = (m) => m & 63;
  const mTo = (m) => (m >> 6) & 63;
  const mPromo = (m) => (m >> 12) & 7;
  const mFlags = (m) => m >> 15;

  // ---------------------------------------------------------------- zobrist
  // Small deterministic PRNG so hashes are stable between runs.
  let seed = 0x1a2b3c4d;
  function rnd32() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  }

  const Z_PIECE = [];   // index: (piece + 6) -> 64 keys
  for (let p = -6; p <= 6; p++) {
    if (p === 0) continue;
    Z_PIECE[p + 6] = [];
    for (let sq = 0; sq < 64; sq++) Z_PIECE[p + 6][sq] = rnd32();
  }
  const Z_CASTLE = [];
  for (let i = 0; i < 16; i++) Z_CASTLE[i] = rnd32();
  const Z_EP = [];
  for (let i = 0; i < 8; i++) Z_EP[i] = rnd32();
  const Z_SIDE = rnd32();

  AC.C = {
    FILES,
    START_FEN,
    SQUARE_NAMES,
    SQUARE_INDEX,
    KNIGHT_TARGETS,
    KING_TARGETS,
    BISHOP_DIRS,
    ROOK_DIRS,
    QUEEN_DIRS,
    CASTLE_MASK,
    CASTLE_WK,
    CASTLE_WQ,
    CASTLE_BK,
    CASTLE_BQ,

    WHITE: 1,
    BLACK: -1,

    PAWN: 1,
    KNIGHT: 2,
    BISHOP: 3,
    ROOK: 4,
    QUEEN: 5,
    KING: 6,

    F_EP,
    F_CASTLE,
    F_DOUBLE,

    PIECE_LETTER: { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' },
    LETTER_PIECE: { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6 },
    VALUE: { 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 20000 },

    START_BOARD: [
      -4, -2, -3, -5, -6, -3, -2, -4,
      -1, -1, -1, -1, -1, -1, -1, -1,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
      4, 2, 3, 5, 6, 3, 2, 4
    ],

    MATE: 100000,
    INF: 1000000,

    mv,
    mFrom,
    mTo,
    mPromo,
    mFlags,

    fileOf(sq) { return sq & 7; },
    rankOf(sq) { return sq >> 3; },
    squareOf(file, rank) { return rank * 8 + file; },
    typeOf(piece) { return Math.abs(piece); },
    colorOf(piece) { return piece > 0 ? 1 : -1; },
    other(side) { return -side; },

    Z: { piece: Z_PIECE, castle: Z_CASTLE, ep: Z_EP, side: Z_SIDE }
  };
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
