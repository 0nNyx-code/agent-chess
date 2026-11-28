// Interaction smoke test for the Vitrine Glass shell.
// Run: node tests/ui-flows.mjs   (set AC_FILE=dist/agent-chess.html for the bundle)
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire('/root/dioramas/');
const { firefox } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.AC_FILE
  ? path.resolve(root, process.env.AC_FILE)
  : path.join(root, 'app', 'index.html');

const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForTimeout(2200);

const splashHidden = await page.evaluate(() => document.querySelector('#splash')?.classList.contains('hide'));

// panel toggle
await page.click('#btn-panel');
const panelOpen = await page.evaluate(() => !document.querySelector('#panel')?.classList.contains('collapsed'));

// settings: switch theme + toggle FX
await page.click('#btn-settings');
await page.waitForTimeout(350);
await page.click('[data-theme="aurora"]');
await page.click('[data-toggle="fx"]');
const settingsState = await page.evaluate(() => ({
  theme: document.documentElement.dataset.board,
  fx: document.querySelector('[data-toggle="fx"]')?.classList.contains('on')
}));
await page.click('.modal [data-close]');
await page.waitForTimeout(250);

// new game: 2 players
await page.click('#btn-new');
await page.waitForTimeout(350);
await page.click('[data-group="mode"] [data-value="local"]');
await page.click('#modal-start');
await page.waitForTimeout(400);
const mode = await page.evaluate(() => ({
  meta: document.querySelector('#meta-mode')?.textContent,
  status: document.querySelector('#status')?.textContent,
  board: document.querySelectorAll('.piece').length
}));

// a legal move in local mode
await page.click('.sq[data-sq="12"]');
await page.waitForTimeout(120);
await page.click('.sq[data-sq="28"]');
await page.waitForTimeout(900);
const afterMove = await page.evaluate(() => ({
  status: document.querySelector('#status')?.textContent,
  handle: document.querySelector('#handle-count')?.textContent,
  povSeen: document.querySelector('#board-stage')?.classList.contains('pov')
}));

await page.screenshot({ path: '/tmp/opencode/ac-flows.png' });
await browser.close();

console.log(JSON.stringify({ splashHidden, panelOpen, settingsState, mode, afterMove, errors }, null, 2));
if (errors.length) process.exitCode = 1;
