// UI smoke test: loads the app in Firefox via Playwright, reports console
// errors, piece counts and saves a screenshot. Run: node tests/ui-smoke.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire('/root/dioramas/');
const { firefox } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.AC_FILE
  ? path.resolve(root, process.env.AC_FILE)
  : path.join(root, 'app', 'index.html');
const url = 'file://' + target;
const shot = process.argv[2] || '/tmp/opencode/agent-chess.png';

const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => ({
  pieces: document.querySelectorAll('.piece').length,
  squares: document.querySelectorAll('.sq').length,
  status: document.querySelector('#status')?.textContent,
  moves: document.querySelectorAll('.move-row').length,
  boardW: Math.round(document.querySelector('#board')?.getBoundingClientRect().width || 0),
  boardH: Math.round(document.querySelector('#board')?.getBoundingClientRect().height || 0),
  hasEngine: typeof window.AC?.Engine?.fromFen === 'function',
  hasSearch: typeof window.AC?.Search?.findBestMove === 'function'
}));

// click e2 then e4 and wait for the AI reply
await page.click('.sq[data-sq="12"]');
await page.waitForTimeout(150);
await page.click('.sq[data-sq="28"]');
await page.waitForTimeout(4000);

const after = await page.evaluate(() => ({
  pieces: document.querySelectorAll('.piece').length,
  moves: document.querySelectorAll('.move-row').length,
  status: document.querySelector('#status')?.textContent,
  engine: document.querySelector('#engine-chip')?.textContent,
  san: Array.from(document.querySelectorAll('.san')).map((b) => b.textContent).join(' ')
}));

await page.screenshot({ path: shot, fullPage: false });
await browser.close();

console.log(JSON.stringify({ info, after, errors }, null, 2));
if (errors.length) process.exitCode = 1;
