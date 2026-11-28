#!/usr/bin/env node
/* Search sanity tests: mate finding, tactics, state immutability.
 * Run: node tests/search.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {}, console };
vm.createContext(sandbox);

for (const file of [
  'app/js/core/constants.js',
  'app/js/core/engine.js',
  'app/js/ai/eval.js',
  'app/js/ai/search.js'
]) {
  const full = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
}

const AC = sandbox.window.AC;
const E = AC.Engine;
const S = AC.Search;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  OK   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
}

console.log('\nMate in one');
{
  const tests = [
    {
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
      uci: 'h5f7',
      label: "scholar's mate Qxf7#"
    },
    {
      fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
      uci: 'a1a8',
      label: 'back rank Ra8#'
    },
    {
      fen: '7k/6pp/8/8/8/8/6PP/R5K1 w - - 0 1',
      uci: 'a1a8',
      label: 'back rank with h-pawns'
    }
  ];

  for (const test of tests) {
    const state = E.fromFen(test.fen);
    const res = S.findBestMove(state, { depth: 3, timeMs: 1200, margin: 0 });
    const uci = res.move ? E.moveToUci(res.move) : '-';
    check(test.label, uci === test.uci && res.score > AC.C.MATE - 1000, `played ${uci}, score ${res.score}`);
  }
}

console.log('\nWinning capture');
{
  const state = E.fromFen('rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1');
  const res = S.findBestMove(state, { depth: 4, timeMs: 1500, margin: 0 });
  const uci = res.move ? E.moveToUci(res.move) : '-';
  check('Nxd5 wins the queen', uci === 'c3d5', `played ${uci}, score ${res.score}`);
}

console.log('\nFree pawn');
{
  const state = E.fromFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  const res = S.findBestMove(state, { depth: 4, timeMs: 1200, margin: 0 });
  const uci = res.move ? E.moveToUci(res.move) : '-';
  check('exd5', uci === 'e4d5', `played ${uci}, score ${res.score}`);
}

console.log('\nInput state is not mutated');
{
  const state = E.fromFen(AC.C.START_FEN);
  const before = E.toFen(state);
  S.findBestMove(state, { depth: 3, timeMs: 800 });
  check('FEN unchanged after search', E.toFen(state) === before, E.toFen(state));
}

console.log('\nSearch returns a legal move at every level');
{
  const state = E.fromFen(AC.C.START_FEN);
  for (const level of Object.keys(S.LEVELS)) {
    const res = S.findBestMove(state, { level });
    const legal = res.move && E.generateMoves(state).includes(res.move);
    check(`level ${level}`, Boolean(legal), `d${res.depth} ${res.nodes} nodes ${res.timeMs}ms`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
