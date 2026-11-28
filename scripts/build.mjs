#!/usr/bin/env node
/* Agent Chess — single-file bundler.
 *
 * Produces dist/agent-chess.html with:
 *   - CSS inlined
 *   - every classic script inlined in load order
 *   - the 12 piece PNGs as data URIs (window.AC_PIECE_DATA)
 *   - the AI as an inline Blob-worker source (window.AC_WORKER_SOURCE)
 *
 * The same file is copied to android/assets/index.html for the APK.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const dist = path.join(root, 'dist');
const androidAssets = path.join(root, 'android', 'assets');

const read = (p) => fs.readFileSync(p, 'utf8');
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

let html = read(path.join(app, 'index.html'));

// ------------------------------------------------------------------- styles
let css = read(path.join(app, 'css', 'style.css'));

// Self-hosted fonts become data URIs so the WebView needs no network.
const fontDir = path.join(app, 'assets', 'fonts');
let fontCount = 0;
if (fs.existsSync(fontDir)) {
  for (const name of fs.readdirSync(fontDir).filter((f) => f.endsWith('.woff2'))) {
    const uri = 'data:font/woff2;base64,' +
      fs.readFileSync(path.join(fontDir, name)).toString('base64');
    css = css.split("../assets/fonts/" + name).join(uri);
    fontCount++;
  }
}
if (!html.includes('href="css/style.css"')) throw new Error('CSS link not found');
html = html.replace(
  '<link rel="stylesheet" href="css/style.css">',
  `<style>\n${css}\n</style>`
);

// -------------------------------------------------------------- piece data
const TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const pieceData = {};
for (const type of TYPES) {
  for (const color of ['w', 'b']) {
    const file = path.join(app, 'assets', 'pieces', `${type}-${color}.png`);
    pieceData[`${type}-${color}`] =
      'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  }
}

// ------------------------------------------------------------- worker source
const workerParts = [
  'js/core/constants.js',
  'js/core/engine.js',
  'js/ai/eval.js',
  'js/ai/search.js'
].map((rel) => read(path.join(app, rel)));

const workerBootstrap = `
self.onmessage = function (event) {
  var msg = event.data || {};
  try {
    var state = AC.Engine.fromFen(msg.fen);
    var result = AC.Search.findBestMove(state, {
      level: msg.level,
      depth: msg.depth,
      timeMs: msg.timeMs
    });
    self.postMessage({
      id: msg.id,
      move: result.move,
      best: result.best,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
      timeMs: result.timeMs
    });
  } catch (err) {
    self.postMessage({ id: msg.id, error: String((err && err.message) || err) });
  }
};
`;

const workerSource = workerParts.join('\n') + '\n' + workerBootstrap;

// ------------------------------------------------------------------- inject
const injection =
  '<script>\n' +
  'window.AC_PIECE_DATA = ' + JSON.stringify(pieceData) + ';\n' +
  'window.AC_WORKER_SOURCE = ' + JSON.stringify(workerSource) + ';\n' +
  '</script>\n';

const anchor = '<script src="js/core/constants.js"></script>';
if (!html.includes(anchor)) throw new Error('script anchor not found');
html = html.replace(anchor, injection + anchor);

// ---------------------------------------------------------------- inline js
let inlined = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (match, src) => {
  const file = path.join(app, src);
  if (!fs.existsSync(file)) throw new Error('missing script: ' + src);
  inlined++;
  return `<script>\n${safeScript(read(file))}\n</script>`;
});

if (inlined < 6) throw new Error('expected at least 6 scripts, inlined ' + inlined);

// --------------------------------------------------------------- write out
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(androidAssets, { recursive: true });

const out = path.join(dist, 'agent-chess.html');
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(androidAssets, 'index.html'), html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('built ' + path.relative(root, out));
console.log('  size      ' + kb(Buffer.byteLength(html)));
console.log('  scripts   ' + inlined);
console.log('  pieces    ' + Object.keys(pieceData).length);
console.log('  fonts     ' + fontCount);
console.log('  worker    ' + kb(Buffer.byteLength(workerSource)));
console.log('copied to android/assets/index.html');
