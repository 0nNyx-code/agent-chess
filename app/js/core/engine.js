/* Agent Chess — board state, legal move generation, FEN/SAN, perft.
 *
 * Board is a flat Int8Array(64), a1 = 0, h8 = 63. White pieces are positive,
 * black negative. Moves are packed integers:
 *
 *   bits 0-5   from square
 *   bits 6-11  to square
 *   bits 12-14 promotion piece type (0 = none)
 *   bits 15-17 flags (en passant / castle / double push)
 *
 * Everything is hand written: no chess.js, no Stockfish.
 */
(function (AC) {
  'use strict';

  const C = AC.C;
  const { Z, SQUARE_NAMES, FILES, PIECE_LETTER } = C;
  const F_EP = C.F_EP;
  const F_CASTLE = C.F_CASTLE;
  const F_DOUBLE = C.F_DOUBLE;

  // ------------------------------------------------------------------ state

  function create(fen) {
    return fromFen(fen || C.START_FEN);
  }

  function fromFen(fen) {
    if (typeof fen !== 'string') throw new Error('FEN must be a string');
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('FEN needs at least 4 fields');

    const board = new Int8Array(64);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN board must have 8 ranks');

    for (let r = 0; r < 8; r++) {
      let file = 0;
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch >= '1' && ch <= '8') {
          file += Number(ch);
        } else {
          const upper = ch.toUpperCase();
          const type = C.LETTER_PIECE[upper];
          if (!type) throw new Error('Bad FEN piece: ' + ch);
          if (file > 7) throw new Error('FEN rank overflow');
          board[(7 - r) * 8 + file] = ch === upper ? type : -type;
          file++;
        }
      }
      if (file !== 8) throw new Error('FEN rank must fill 8 files');
    }

    const turn = parts[1] === 'b' ? -1 : 1;

    let castling = 0;
    if (parts[2] !== '-') {
      if (parts[2].includes('K')) castling |= C.CASTLE_WK;
      if (parts[2].includes('Q')) castling |= C.CASTLE_WQ;
      if (parts[2].includes('k')) castling |= C.CASTLE_BK;
      if (parts[2].includes('q')) castling |= C.CASTLE_BQ;
    }

    let ep = -1;
    if (parts[3] !== '-') {
      const sq = C.SQUARE_INDEX[parts[3]];
      if (sq === undefined) throw new Error('Bad FEN en-passant square');
      ep = sq;
    }

    const half = parts[4] !== undefined ? Math.max(0, parseInt(parts[4], 10) || 0) : 0;
    const full = parts[5] !== undefined ? Math.max(1, parseInt(parts[5], 10) || 1) : 1;

    const kings = new Int8Array(2).fill(-1);
    for (let sq = 0; sq < 64; sq++) {
      if (board[sq] === 6) kings[0] = sq;
      else if (board[sq] === -6) kings[1] = sq;
    }
    if (kings[0] < 0 || kings[1] < 0) throw new Error('FEN must contain both kings');

    const state = { board, turn, castling, ep, half, full, kings, hash: 0 };
    state.hash = computeHash(state);
    return state;
  }

  function clone(s) {
    return {
      board: new Int8Array(s.board),
      turn: s.turn,
      castling: s.castling,
      ep: s.ep,
      half: s.half,
      full: s.full,
      kings: new Int8Array(s.kings),
      hash: s.hash
    };
  }

  function computeHash(s) {
    let h = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = s.board[sq];
      if (p) h ^= Z.piece[p + 6][sq];
    }
    h ^= Z.castle[s.castling];
    if (s.ep >= 0) h ^= Z.ep[s.ep & 7];
    if (s.turn === -1) h ^= Z.side;
    return h >>> 0;
  }

  // ------------------------------------------------------------- attack test

  function isAttacked(board, sq, by) {
    const f = sq & 7;
    const r = sq >> 3;

    if (by === 1) {
      if (f > 0 && board[sq - 9] === 1) return true;
      if (f < 7 && board[sq - 7] === 1) return true;
    } else {
      if (f > 0 && board[sq + 7] === -1) return true;
      if (f < 7 && board[sq + 9] === -1) return true;
    }

    const knights = C.KNIGHT_TARGETS[sq];
    for (let i = 0; i < knights.length; i++) {
      if (board[knights[i]] === by * 2) return true;
    }

    const kings = C.KING_TARGETS[sq];
    for (let i = 0; i < kings.length; i++) {
      if (board[kings[i]] === by * 6) return true;
    }

    for (let i = 0; i < 4; i++) {
      const d = C.BISHOP_DIRS[i];
      let nf = f + d[0];
      let nr = r + d[1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const p = board[nr * 8 + nf];
        if (p) {
          if (p === by * 3 || p === by * 5) return true;
          break;
        }
        nf += d[0];
        nr += d[1];
      }
    }

    for (let i = 0; i < 4; i++) {
      const d = C.ROOK_DIRS[i];
      let nf = f + d[0];
      let nr = r + d[1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const p = board[nr * 8 + nf];
        if (p) {
          if (p === by * 4 || p === by * 5) return true;
          break;
        }
        nf += d[0];
        nr += d[1];
      }
    }

    return false;
  }

  function inCheck(s, side) {
    const kingSq = s.kings[side === 1 ? 0 : 1];
    if (kingSq < 0) return false;
    return isAttacked(s.board, kingSq, -side);
  }

  // --------------------------------------------------------- move generation

  function generatePseudo(s) {
    const moves = [];
    const board = s.board;
    const turn = s.turn;

    for (let from = 0; from < 64; from++) {
      const piece = board[from];
      if (!piece) continue;
      if ((piece > 0 ? 1 : -1) !== turn) continue;
      const type = piece > 0 ? piece : -piece;
      const f = from & 7;
      const r = from >> 3;

      if (type === 1) {
        const dir = turn === 1 ? 8 : -8;
        const startRank = turn === 1 ? 1 : 6;
        const promoRank = turn === 1 ? 7 : 0;
        const one = from + dir;

        if (one >= 0 && one < 64 && board[one] === 0) {
          if ((one >> 3) === promoRank) {
            moves.push(C.mv(from, one, 5, 0));
            moves.push(C.mv(from, one, 4, 0));
            moves.push(C.mv(from, one, 3, 0));
            moves.push(C.mv(from, one, 2, 0));
          } else {
            moves.push(C.mv(from, one, 0, 0));
            if (r === startRank) {
              const two = from + dir * 2;
              if (board[two] === 0) moves.push(C.mv(from, two, 0, F_DOUBLE));
            }
          }
        }

        for (let df = -1; df <= 1; df += 2) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const to = from + dir + df;
          if (to < 0 || to > 63) continue;
          const target = board[to];
          if (target && (target > 0 ? 1 : -1) !== turn) {
            if ((to >> 3) === promoRank) {
              moves.push(C.mv(from, to, 5, 0));
              moves.push(C.mv(from, to, 4, 0));
              moves.push(C.mv(from, to, 3, 0));
              moves.push(C.mv(from, to, 2, 0));
            } else {
              moves.push(C.mv(from, to, 0, 0));
            }
          } else if (to === s.ep) {
            moves.push(C.mv(from, to, 0, F_EP));
          }
        }
        continue;
      }

      if (type === 2) {
        const targets = C.KNIGHT_TARGETS[from];
        for (let i = 0; i < targets.length; i++) {
          const to = targets[i];
          const target = board[to];
          if (!target || (target > 0 ? 1 : -1) !== turn) moves.push(C.mv(from, to, 0, 0));
        }
        continue;
      }

      if (type === 6) {
        const targets = C.KING_TARGETS[from];
        for (let i = 0; i < targets.length; i++) {
          const to = targets[i];
          const target = board[to];
          if (!target || (target > 0 ? 1 : -1) !== turn) moves.push(C.mv(from, to, 0, 0));
        }

        if (turn === 1) {
          if ((s.castling & C.CASTLE_WK) && board[4] === 6 && board[7] === 4 &&
              board[5] === 0 && board[6] === 0 &&
              !isAttacked(board, 4, -1) && !isAttacked(board, 5, -1) && !isAttacked(board, 6, -1)) {
            moves.push(C.mv(4, 6, 0, F_CASTLE));
          }
          if ((s.castling & C.CASTLE_WQ) && board[4] === 6 && board[0] === 4 &&
              board[1] === 0 && board[2] === 0 && board[3] === 0 &&
              !isAttacked(board, 4, -1) && !isAttacked(board, 3, -1) && !isAttacked(board, 2, -1)) {
            moves.push(C.mv(4, 2, 0, F_CASTLE));
          }
        } else {
          if ((s.castling & C.CASTLE_BK) && board[60] === -6 && board[63] === -4 &&
              board[61] === 0 && board[62] === 0 &&
              !isAttacked(board, 60, 1) && !isAttacked(board, 61, 1) && !isAttacked(board, 62, 1)) {
            moves.push(C.mv(60, 62, 0, F_CASTLE));
          }
          if ((s.castling & C.CASTLE_BQ) && board[60] === -6 && board[56] === -4 &&
              board[57] === 0 && board[58] === 0 && board[59] === 0 &&
              !isAttacked(board, 60, 1) && !isAttacked(board, 59, 1) && !isAttacked(board, 58, 1)) {
            moves.push(C.mv(60, 58, 0, F_CASTLE));
          }
        }
        continue;
      }

      // sliding pieces: bishop 3, rook 4, queen 5
      const dirs = type === 3 ? C.BISHOP_DIRS : type === 4 ? C.ROOK_DIRS : C.QUEEN_DIRS;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        let nf = f + d[0];
        let nr = r + d[1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const to = nr * 8 + nf;
          const target = board[to];
          if (!target) {
            moves.push(C.mv(from, to, 0, 0));
          } else {
            if ((target > 0 ? 1 : -1) !== turn) moves.push(C.mv(from, to, 0, 0));
            break;
          }
          nf += d[0];
          nr += d[1];
        }
      }
    }

    return moves;
  }

  function generateMoves(s) {
    const pseudo = generatePseudo(s);
    const legal = [];
    const us = s.turn;
    const kingIdx = us === 1 ? 0 : 1;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      const undo = makeMove(s, m);
      const safe = !isAttacked(s.board, s.kings[kingIdx], -us);
      unmakeMove(s, undo);
      if (safe) legal.push(m);
    }
    return legal;
  }

  function generateCaptures(s) {
    const all = generateMoves(s);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      const to = (m >> 6) & 63;
      if (s.board[to] !== 0 || ((m >> 15) & 7 & F_EP)) out.push(m);
    }
    return out;
  }

  // ------------------------------------------------------------- make/unmake

  function makeMove(s, m) {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flags = m >> 15;
    const board = s.board;
    const piece = board[from];
    const side = piece > 0 ? 1 : -1;
    const type = piece > 0 ? piece : -piece;

    let captured = 0;
    let capSq = to;
    if (flags & F_EP) {
      capSq = to - side * 8;
      captured = board[capSq];
    } else {
      captured = board[to];
    }

    const undo = {
      m,
      captured,
      capSq,
      castling: s.castling,
      ep: s.ep,
      half: s.half,
      full: s.full,
      hash: s.hash
    };

    let h = s.hash;

    if (captured) {
      board[capSq] = 0;
      h ^= Z.piece[captured + 6][capSq];
    }

    board[from] = 0;
    h ^= Z.piece[piece + 6][from];

    const placed = promo ? promo * side : piece;
    board[to] = placed;
    h ^= Z.piece[placed + 6][to];

    if (type === 6) {
      s.kings[side === 1 ? 0 : 1] = to;
      if (flags & F_CASTLE) {
        let rf;
        let rt;
        if (to === 6) { rf = 7; rt = 5; }
        else if (to === 2) { rf = 0; rt = 3; }
        else if (to === 62) { rf = 63; rt = 61; }
        else { rf = 56; rt = 59; }
        const rook = board[rf];
        board[rf] = 0;
        board[rt] = rook;
        h ^= Z.piece[rook + 6][rf] ^ Z.piece[rook + 6][rt];
      }
    }

    const newEp = (flags & F_DOUBLE) ? ((from + to) >> 1) : -1;
    if (s.ep >= 0) h ^= Z.ep[s.ep & 7];
    if (newEp >= 0) h ^= Z.ep[newEp & 7];
    s.ep = newEp;

    const newCastling = s.castling & C.CASTLE_MASK[from] & C.CASTLE_MASK[to];
    if (newCastling !== s.castling) {
      h ^= Z.castle[s.castling] ^ Z.castle[newCastling];
      s.castling = newCastling;
    }

    if (type === 1 || captured) s.half = 0;
    else s.half++;
    if (side === -1) s.full++;

    s.turn = -side;
    h ^= Z.side;
    s.hash = h >>> 0;
    return undo;
  }

  function unmakeMove(s, undo) {
    const m = undo.m;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flags = m >> 15;
    const board = s.board;

    s.turn = -s.turn;
    const side = s.turn;
    const placed = board[to];
    const type = placed > 0 ? placed : -placed;

    if (type === 6) {
      s.kings[side === 1 ? 0 : 1] = from;
      if (flags & F_CASTLE) {
        let rf;
        let rt;
        if (to === 6) { rf = 7; rt = 5; }
        else if (to === 2) { rf = 0; rt = 3; }
        else if (to === 62) { rf = 63; rt = 61; }
        else { rf = 56; rt = 59; }
        const rook = board[rt];
        board[rt] = 0;
        board[rf] = rook;
      }
    }

    board[from] = promo ? side : placed;
    board[to] = 0;
    if (undo.captured) board[undo.capSq] = undo.captured;

    s.castling = undo.castling;
    s.ep = undo.ep;
    s.half = undo.half;
    s.full = undo.full;
    s.hash = undo.hash;
  }

  // -------------------------------------------------------------------- FEN

  function toFen(s) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = s.board[r * 8 + f];
        if (!p) {
          empty++;
        } else {
          if (empty) { row += empty; empty = 0; }
          const letter = PIECE_LETTER[p > 0 ? p : -p];
          row += p > 0 ? letter : letter.toLowerCase();
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }

    let castling = '';
    if (s.castling & C.CASTLE_WK) castling += 'K';
    if (s.castling & C.CASTLE_WQ) castling += 'Q';
    if (s.castling & C.CASTLE_BK) castling += 'k';
    if (s.castling & C.CASTLE_BQ) castling += 'q';
    if (!castling) castling = '-';

    return [
      rows.join('/'),
      s.turn === 1 ? 'w' : 'b',
      castling,
      s.ep >= 0 ? SQUARE_NAMES[s.ep] : '-',
      s.half,
      s.full
    ].join(' ');
  }

  // -------------------------------------------------------------------- SAN

  function moveToSan(s, m) {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flags = m >> 15;
    const piece = s.board[from];
    if (!piece) return '??';
    const type = piece > 0 ? piece : -piece;

    let san;
    if (flags & F_CASTLE) {
      san = (to & 7) === 6 ? 'O-O' : 'O-O-O';
    } else if (type === 1) {
      san = '';
      if (s.board[to] || (flags & F_EP)) san += FILES[from & 7] + 'x';
      san += SQUARE_NAMES[to];
      if (promo) san += '=' + PIECE_LETTER[promo];
    } else {
      san = PIECE_LETTER[type];

      const legal = generateMoves(s);
      const rivals = [];
      for (let i = 0; i < legal.length; i++) {
        const other = legal[i];
        if (other === m) continue;
        if (((other >> 6) & 63) !== to) continue;
        const op = s.board[other & 63];
        if ((op > 0 ? op : -op) === type) rivals.push(other);
      }

      if (rivals.length) {
        let sameFile = false;
        let sameRank = false;
        for (let i = 0; i < rivals.length; i++) {
          if (((rivals[i] & 63) & 7) === (from & 7)) sameFile = true;
          if (((rivals[i] & 63) >> 3) === (from >> 3)) sameRank = true;
        }
        if (!sameFile) san += FILES[from & 7];
        else if (!sameRank) san += (from >> 3) + 1;
        else san += SQUARE_NAMES[from];
      }

      if (s.board[to]) san += 'x';
      san += SQUARE_NAMES[to];
    }

    const undo = makeMove(s, m);
    const check = inCheck(s, s.turn);
    let suffix = '';
    if (check) suffix = generateMoves(s).length ? '+' : '#';
    unmakeMove(s, undo);

    return san + suffix;
  }

  function moveToUci(m) {
    let out = SQUARE_NAMES[m & 63] + SQUARE_NAMES[(m >> 6) & 63];
    const promo = (m >> 12) & 7;
    if (promo) out += PIECE_LETTER[promo].toLowerCase();
    return out;
  }

  function moveFromUci(s, uci) {
    if (typeof uci !== 'string' || uci.length < 4) return 0;
    const from = C.SQUARE_INDEX[uci.slice(0, 2)];
    const to = C.SQUARE_INDEX[uci.slice(2, 4)];
    if (from === undefined || to === undefined) return 0;
    const promo = uci.length > 4 ? C.LETTER_PIECE[uci[4].toUpperCase()] || 0 : 0;
    const moves = generateMoves(s);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if ((m & 63) !== from || ((m >> 6) & 63) !== to) continue;
      if (promo && ((m >> 12) & 7) !== promo) continue;
      return m;
    }
    return 0;
  }

  function normalizeSan(san) {
    return String(san)
      .trim()
      .replace(/^\.+/, '')
      .replace(/[+#?!]+$/g, '')
      .replace(/0/g, 'O')
      .replace(/e\.p\./i, '');
  }

  function moveFromSan(s, san) {
    if (!san) return 0;
    const target = normalizeSan(san);
    const loose = target.replace(/[x=]/g, '');
    const moves = generateMoves(s);
    let fallback = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const candidate = normalizeSan(moveToSan(s, m));
      if (candidate === target) return m;
      if (!fallback && candidate.replace(/[x=]/g, '') === loose) fallback = m;
    }
    return fallback;
  }

  // ----------------------------------------------------------------- status

  function insufficientMaterial(s) {
    let minors = 0;
    let bishops = 0;
    let bishopSquareColor = -1;
    let sameColor = true;

    for (let sq = 0; sq < 64; sq++) {
      const p = s.board[sq];
      if (!p) continue;
      const type = p > 0 ? p : -p;
      if (type === 1 || type === 4 || type === 5) return false;
      if (type === 2) minors++;
      if (type === 3) {
        minors++;
        bishops++;
        const color = ((sq & 7) + (sq >> 3)) & 1;
        if (bishopSquareColor < 0) bishopSquareColor = color;
        else if (bishopSquareColor !== color) sameColor = false;
      }
    }

    if (minors === 0) return true;
    if (minors === 1) return true;
    if (bishops === minors && sameColor) return true;
    return false;
  }

  function status(s, opts) {
    const moves = generateMoves(s);
    if (!moves.length) {
      if (inCheck(s, s.turn)) {
        return {
          over: true,
          result: s.turn === 1 ? '0-1' : '1-0',
          reason: 'checkmate',
          winner: s.turn === 1 ? -1 : 1,
          moves
        };
      }
      return { over: true, result: '1/2-1/2', reason: 'stalemate', winner: 0, moves };
    }
    if (s.half >= 100) {
      return { over: true, result: '1/2-1/2', reason: 'fifty-move', winner: 0, moves };
    }
    if (insufficientMaterial(s)) {
      return { over: true, result: '1/2-1/2', reason: 'insufficient', winner: 0, moves };
    }
    return { over: false, result: '*', reason: 'ongoing', winner: 0, moves };
  }

  // ------------------------------------------------------------------ perft

  function perft(s, depth) {
    if (depth <= 0) return 1;
    const moves = generateMoves(s);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (let i = 0; i < moves.length; i++) {
      const undo = makeMove(s, moves[i]);
      nodes += perft(s, depth - 1);
      unmakeMove(s, undo);
    }
    return nodes;
  }

  function perftDivide(s, depth) {
    const out = {};
    const moves = generateMoves(s);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const undo = makeMove(s, m);
      out[moveToUci(m)] = depth <= 1 ? 1 : perft(s, depth - 1);
      unmakeMove(s, undo);
    }
    return out;
  }

  // ---------------------------------------------------------------- helpers

  function isCapture(s, m) {
    const flags = m >> 15;
    if (flags & F_EP) return true;
    return s.board[(m >> 6) & 63] !== 0;
  }

  function isPromotion(m) {
    return ((m >> 12) & 7) !== 0;
  }

  AC.Engine = {
    create,
    clone,
    fromFen,
    toFen,
    computeHash,
    isAttacked,
    inCheck,
    generatePseudo,
    generateMoves,
    generateCaptures,
    makeMove,
    unmakeMove,
    moveToSan,
    moveToUci,
    moveFromUci,
    moveFromSan,
    normalizeSan,
    insufficientMaterial,
    status,
    perft,
    perftDivide,
    isCapture,
    isPromotion
  };
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
