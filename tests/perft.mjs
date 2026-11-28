#!/usr/bin/env node
/* Perft correctness tests against the canonical chessprogramming counts.
 * Run: node tests/perft.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {}, console };
vm.createContext(sandbox);

for (const file of ['app/js/core/constants.js', 'app/js/core/engine.js']) {
  const full = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
}

const AC = sandbox.window.AC;
const E = AC.Engine;

const cases = [
  {
    name: 'startpos',
    fen: AC.C.START_FEN,
    counts: [20, 400, 8902, 197281]
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862]
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238]
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467]
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379]
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890]
  }
];

let failed = 0;
let passed = 0;

for (const test of cases) {
  console.log(`\n${test.name}`);
  for (let depth = 1; depth <= test.counts.length; depth++) {
    const state = E.fromFen(test.fen);
    const expected = test.counts[depth - 1];
    const started = process.hrtime.bigint();
    const actual = E.perft(state, depth);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const ok = actual === expected;
    if (ok) passed++;
    else failed++;
    console.log(
      `  d${depth}: ${String(actual).padStart(8)} expected ${String(expected).padStart(8)}` +
      `  ${ok ? 'OK' : 'FAIL'}  (${ms.toFixed(1)} ms)`
    );
  }
}

// FEN round trip and SAN smoke tests.
console.log('\nFEN round trip');
for (const test of cases) {
  const fen = E.toFen(E.fromFen(test.fen));
  const ok = fen === test.fen;
  if (ok) passed++;
  else failed++;
  console.log(`  ${test.name}: ${ok ? 'OK' : 'FAIL ' + fen}`);
}

console.log('\nSAN smoke test (Italian game)');
{
  const state = E.fromFen(AC.C.START_FEN);
  const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d4', 'e5d4'];
  const played = [];
  const parsed = [];
  for (const uci of line) {
    const move = E.moveFromUci(state, uci);
    if (!move) { played.push(`!!${uci}`); break; }
    const san = E.moveToSan(state, move);
    played.push(san);
    const back = E.moveFromSan(state, san);
    parsed.push(back === move ? san : `!!${san}`);
    E.makeMove(state, move);
  }
  const expected = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'];
  const ok = played.join(' ') === expected.join(' ') && parsed.join(' ') === expected.join(' ');
  if (ok) passed++;
  else failed++;
  console.log(`  ${played.join(' ')}`);
  console.log(`  round trip: ${parsed.join(' ')}`);
  console.log(`  ${ok ? 'OK' : 'FAIL, expected ' + expected.join(' ')}`);
}

console.log('\nMate detection');
{
  // Fool's mate
  const state = E.fromFen(AC.C.START_FEN);
  for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    const move = E.moveFromUci(state, uci);
    E.makeMove(state, move);
  }
  const st = E.status(state);
  const ok = st.over && st.reason === 'checkmate' && st.result === '0-1';
  if (ok) passed++;
  else failed++;
  console.log(`  fool's mate: ${JSON.stringify({ over: st.over, reason: st.reason, result: st.result })} ${ok ? 'OK' : 'FAIL'}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
