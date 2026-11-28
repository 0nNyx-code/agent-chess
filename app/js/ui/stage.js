/* EPIC Chess — stage shell.
 *
 * Owns the parts of the interface the game controller does not know about:
 * the intro hand-off, the transport (Bermain / Pause), the mode sheet and the
 * move drawer. It talks to the game through the small AC.App surface.
 */
(function (AC) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

  const el = {
    splash: $('#splash'),
    play: $('#stage-play'),
    pause: $('#stage-pause'),
    movesBtn: $('#stage-moves'),
    movesCount: $('#stage-moves-count'),
    handleCount: $('#handle-count'),
    layer: $('#moves-layer'),
    scrim: $('#moves-scrim'),
    panel: $('#panel'),
    panelBtn: $('#btn-panel')
  };

  let sheetEl = null;
  let closeTimer = null;

  const ICONS = {
    adventure: '<path d="M12 3.5 4.5 8v8L12 20.5 19.5 16V8L12 3.5Z"/><path d="M12 3.5V20.5M4.5 8 12 12l7.5-4"/>',
    rank: '<path d="M5 19h14M7 19V9l5-4 5 4v10"/><path d="M10 19v-5h4v5"/>',
    bot: '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 4.5V8M8.5 12.5v2M15.5 12.5v2M9 19v1.5M15 19v1.5"/>',
    puzzle: '<path d="M9 4.5h4.5a2.5 2.5 0 1 1 0 5H13v3.5h-3.5a2.5 2.5 0 1 0 0 5H13V20a2 2 0 0 0 2 2h4.5"/><path d="M4.5 9v6"/>',
    atomic: '<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(30 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(90 12 12)"/>',
    classic: '<path d="M7 4.5h10v3l-2 2v3l2 2v3H7v-3l2-2v-3l-2-2v-3Z"/><path d="M8.5 19.5h7"/>',
    newGame: '<path d="M12 5v14M5 12h14"/>',
    undo: '<path d="M8 8H4V4"/><path d="M4.5 8a8 8 0 1 1-1 7.5"/>',
    flip: '<path d="M4 8h16l-3.5-3.5M20 16H4l3.5 3.5"/>',
    hint: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2h5.2c0-.8.3-1.5.9-2A6 6 0 0 0 12 3.5Z"/>',
    moves: '<path d="M5 6h14M5 12h14M5 18h9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>'
  };

  const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

  // ------------------------------------------------------------- intro hand-off

  function revealStage() {
    document.documentElement.classList.add('stage-in');
  }

  if (el.splash) {
    if (el.splash.classList.contains('hide')) revealStage();
    new MutationObserver(() => {
      if (el.splash.classList.contains('hide')) revealStage();
    }).observe(el.splash, { attributes: true, attributeFilter: ['class'] });
  }
  // Safety net: the stage must never stay invisible if the intro stalls.
  setTimeout(revealStage, 2600);

  // ------------------------------------------------------------- move drawer

  function syncDrawer() {
    if (!el.panel || !el.layer) return;
    const open = !el.panel.classList.contains('collapsed');
    el.layer.classList.toggle('open', open);
    if (el.panelBtn) el.panelBtn.setAttribute('aria-expanded', String(open));
  }

  function openDrawer() {
    if (!el.panel) return;
    el.panel.classList.remove('collapsed');
    syncDrawer();
  }

  function closeDrawer() {
    if (!el.panel) return;
    el.panel.classList.add('collapsed');
    syncDrawer();
  }

  if (el.panel) {
    new MutationObserver(syncDrawer).observe(el.panel, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
  if (el.movesBtn) {
    el.movesBtn.addEventListener('click', () => {
      AC.Sound && AC.Sound.click();
      openDrawer();
    });
  }
  if (el.scrim) {
    el.scrim.addEventListener('click', () => {
      AC.Sound && AC.Sound.click();
      closeDrawer();
    });
  }
  if (el.handleCount && el.movesCount) {
    const syncCount = () => {
      el.movesCount.textContent = el.handleCount.textContent || '0';
    };
    new MutationObserver(syncCount).observe(el.handleCount, {
      childList: true,
      characterData: true,
      subtree: true
    });
    syncCount();
  }

  // ------------------------------------------------------------------- sheets

  function closeSheet(immediate) {
    if (!sheetEl) return;
    const node = sheetEl;
    sheetEl = null;
    clearTimeout(closeTimer);
    node.classList.remove('open');
    if (immediate) {
      node.remove();
    } else {
      closeTimer = setTimeout(() => node.remove(), 520);
    }
  }

  function sheet(html, mount) {
    closeSheet(true);

    const layer = document.createElement('div');
    layer.className = 'sheet-layer';
    layer.innerHTML =
      '<div class="sheet-scrim" data-sheet-close></div>' +
      '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(layer);
    sheetEl = layer;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => layer.classList.add('open'));
    });

    layer.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]')) {
        AC.Sound && AC.Sound.click();
        closeSheet();
      }
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeSheet();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    if (mount) mount(layer.querySelector('.sheet'));
    return layer;
  }

  // -------------------------------------------------------------------- modes

  const MODES = [
    { id: 'adventure', name: 'Adventure', note: 'Story', tag: 'Soon', ready: false },
    { id: 'rank', name: 'Rank', note: 'Ladder', tag: 'Soon', ready: false },
    { id: 'bot', name: 'Play with Bot', note: 'One board', tag: 'Ready', ready: true },
    { id: 'puzzle', name: 'Puzzle', note: 'Set pieces', tag: 'Soon', ready: false },
    { id: 'atomic', name: 'Atomic', note: 'Chain reaction', tag: 'Soon', ready: false },
    { id: 'classic', name: 'Classic', note: 'Two players', tag: 'Ready', ready: true }
  ];

  function modeSheet() {
    sheet(
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<div class="sheet-head">' +
        '<div>' +
          '<h2 class="sheet-title">Choose a mode</h2>' +
          '<p class="sheet-sub">One board. Six ways to enter it.</p>' +
        '</div>' +
        '<button class="sheet-close" type="button" data-sheet-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="mode-grid">' +
        MODES.map((m) =>
          '<button class="mode-card ' + (m.ready ? 'available' : 'locked') + '" type="button" data-mode="' + m.id + '">' +
            '<span class="ico" aria-hidden="true">' + icon(m.id) + '</span>' +
            '<h3>' + m.name + '</h3>' +
            '<p>' + m.note + '</p>' +
            '<span class="tag">' + m.tag + '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
      '<p class="sheet-note">Adventure, Rank, Puzzle and Atomic are still in the workshop. They will arrive as real modes, not as decoration.</p>',
      (root) => {
        root.addEventListener('click', (e) => {
          const card = e.target.closest('[data-mode]');
          if (!card) return;
          const mode = MODES.find((m) => m.id === card.dataset.mode);
          if (!mode) return;
          AC.Sound && AC.Sound.click();
          if (mode.id === 'bot') {
            botSetup();
          } else if (mode.id === 'classic') {
            closeSheet();
            AC.App.newGame({ mode: 'local', humanSide: 1, flipped: false });
            AC.App.showToast('Two players. Pass the board.');
          } else {
            AC.App.showToast(mode.name + ' is coming soon.');
          }
        });
      }
    );
  }

  function botSetup() {
    sheet(
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<div class="sheet-head">' +
        '<div>' +
          '<h2 class="sheet-title">Set the table</h2>' +
          '<p class="sheet-sub">Pick a colour and a difficulty.</p>' +
        '</div>' +
        '<button class="sheet-close" type="button" data-sheet-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label">Play as</span>' +
        '<div class="segmented" data-side>' +
          '<button type="button" data-value="1" class="active">White</button>' +
          '<button type="button" data-value="-1">Black</button>' +
          '<button type="button" data-value="0">Random</button>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label">Difficulty</span>' +
        '<div class="segmented" data-level>' +
          '<button type="button" data-value="easy">Easy</button>' +
          '<button type="button" data-value="medium" class="active">Medium</button>' +
          '<button type="button" data-value="hard">Hard</button>' +
          '<button type="button" data-value="expert">Expert</button>' +
        '</div>' +
      '</div>' +
      '<button class="pause-primary" type="button" data-start>Start game</button>' +
      '<button class="sheet-back" type="button" data-back>All modes</button>',
      (root) => {
        root.querySelectorAll('.segmented').forEach((group) => {
          group.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-value]');
            if (!btn) return;
            group.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            AC.Sound && AC.Sound.click();
          });
        });

        root.querySelector('[data-back]').addEventListener('click', () => {
          AC.Sound && AC.Sound.click();
          modeSheet();
        });

        root.querySelector('[data-start]').addEventListener('click', () => {
          const sideRaw = Number(root.querySelector('[data-side] .active').dataset.value);
          const level = root.querySelector('[data-level] .active').dataset.value;
          const side = sideRaw === 0 ? (Math.random() < 0.5 ? 1 : -1) : sideRaw;
          closeSheet();
          AC.Sound && AC.Sound.click();
          AC.App.newGame({
            mode: 'ai',
            level,
            humanSide: side,
            flipped: side === -1
          });
          AC.App.showToast(side === 1 ? 'Your move.' : 'The agent opens.');
        });
      }
    );
  }

  // -------------------------------------------------------------------- pause

  function pauseSheet() {
    sheet(
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<div class="sheet-head">' +
        '<div>' +
          '<h2 class="sheet-title">Take a breath</h2>' +
          '<p class="sheet-sub">The board will wait.</p>' +
        '</div>' +
        '<button class="sheet-close" type="button" data-sheet-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<button class="pause-primary" type="button" data-resume>Resume</button>' +
      '<div class="pause-actions">' +
        '<button class="pause-action" type="button" data-act="new">' + icon('newGame') + '<span>New game</span></button>' +
        '<button class="pause-action" type="button" data-act="undo">' + icon('undo') + '<span>Undo</span></button>' +
        '<button class="pause-action" type="button" data-act="flip">' + icon('flip') + '<span>Flip</span></button>' +
        '<button class="pause-action" type="button" data-act="hint">' + icon('hint') + '<span>Hint</span></button>' +
        '<button class="pause-action" type="button" data-act="moves">' + icon('moves') + '<span>Moves</span></button>' +
        '<button class="pause-action" type="button" data-act="settings">' + icon('settings') + '<span>Settings</span></button>' +
      '</div>' +
      '<p class="pause-note">Every move is a moment.</p>',
      (root) => {
        root.querySelector('[data-resume]').addEventListener('click', () => {
          AC.Sound && AC.Sound.click();
          closeSheet();
        });

        root.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          AC.Sound && AC.Sound.click();
          const act = btn.dataset.act;
          closeSheet();

          if (act === 'new') AC.App.openNewGame();
          else if (act === 'undo') AC.App.undo();
          else if (act === 'flip') AC.App.flip();
          else if (act === 'hint') AC.App.hint();
          else if (act === 'moves') openDrawer();
          else if (act === 'settings') AC.App.openSettings();
        });
      }
    );
  }

  // ------------------------------------------------------------------ wiring

  if (el.play) {
    el.play.addEventListener('click', () => {
      AC.Sound && AC.Sound.click();
      modeSheet();
    });
  }

  if (el.pause) {
    el.pause.addEventListener('click', () => {
      AC.Sound && AC.Sound.click();
      pauseSheet();
    });
  }
})(window.AC = window.AC || {});
