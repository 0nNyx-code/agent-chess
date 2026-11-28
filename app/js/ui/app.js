/* Agent Chess — game controller and UI wiring. */
(function (AC) {
  'use strict';

  const E = AC.Engine;
  const C = AC.C;
  const S = AC.Search;
  const START = C.START_FEN;
  const SAVE_KEY = 'agentchess.save.v2';
  const SETTINGS_KEY = 'agentchess.settings.v2';
  const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

  const $ = (sel) => document.querySelector(sel);

  const els = {
    board: $('#board'),
    squares: $('#squares'),
    pieces: $('#pieces'),
    opponentBar: $('#opponent-bar'),
    opponentAvatar: $('#opponent-avatar'),
    opponentName: $('#opponent-name'),
    opponentSub: $('#opponent-sub'),
    opponentCaptured: $('#opponent-captured'),
    opponentMaterial: $('#opponent-material'),
    playerBar: $('#player-bar'),
    playerAvatar: $('#player-avatar'),
    playerName: $('#player-name'),
    playerSub: $('#player-sub'),
    playerCaptured: $('#player-captured'),
    playerMaterial: $('#player-material'),
    status: $('#status'),
    engineChip: $('#engine-chip'),
    engineRow: $('#engine-row'),
    evalFill: $('#eval-fill'),
    evalNum: $('#eval-num'),
    moveList: $('#move-list'),
    moveEmpty: $('#move-empty'),
    metaMode: $('#meta-mode'),
    metaLevel: $('#meta-level'),
    btnNew: $('#btn-new'),
    btnUndo: $('#btn-undo'),
    btnFlip: $('#btn-flip'),
    btnHint: $('#btn-hint'),
    btnAuto: $('#btn-auto'),
    btnSound: $('#btn-sound'),
    btnSettings: $('#btn-settings'),
    btnCopyPgn: $('#btn-copy-pgn'),
    btnLive: $('#btn-live'),
    btnPanel: $('#btn-panel'),
    panel: $('#panel'),
    handleCount: $('#handle-count'),
    stage: $('#board-stage') || document.querySelector('.board-stage'),
    subtitle: $('#subtitle-rail'),
    quip: $('#quip'),
    splash: $('#splash'),
    embers: $('#embers'),
    modalRoot: $('#modal-root'),
    toast: $('#toast')
  };

  const settings = {
    sound: true,
    coords: true,
    theme: 'vitrine',
    fx: true,
    quips: true,
    haptics: true
  };

  const game = {
    startFen: START,
    state: E.fromFen(START),
    legal: [],
    moves: [],
    mode: 'ai',
    humanSide: 1,
    level: 'medium',
    flipped: false,
    over: false,
    status: null,
    thinking: false,
    hintBusy: false,
    viewIndex: 0,
    selectedSq: -1,
    tapWasSelected: false,
    reqId: 0,
    autoPaused: false
  };

  let board = null;
  let engine = null;
  let fx = null;
  let aiTimer = null;
  let hintTimer = null;
  let lastInfo = null;

  // ------------------------------------------------------------ engine client

  class EngineClient {
    constructor() {
      this.worker = null;
      this.pending = null;
      this.nextId = 1;
      this.init();
    }

    init() {
      if (typeof Worker === 'undefined') return;
      try {
        if (window.AC_WORKER_SOURCE) {
          const blob = new Blob([window.AC_WORKER_SOURCE], { type: 'text/javascript' });
          const url = URL.createObjectURL(blob);
          this.worker = new Worker(url);
        } else if (location.protocol === 'http:' || location.protocol === 'https:') {
          this.worker = new Worker('js/ai/worker.js');
        }
      } catch (err) {
        this.worker = null;
      }

      if (!this.worker) return;

      this.worker.onmessage = (event) => {
        const msg = event.data || {};
        const pending = this.pending;
        if (!pending || pending.id !== msg.id) return;
        this.pending = null;
        clearTimeout(this.watchdog);
        pending.cb(msg);
      };

      this.worker.onerror = (err) => {
        console.warn('[Agent Chess] worker unavailable, falling back', err);
        const pending = this.pending;
        this.pending = null;
        clearTimeout(this.watchdog);
        this.worker = null;
        if (pending) {
          setTimeout(() => {
            const result = AC.Search.findBestMove(E.clone(pending.state), pending.opts);
            pending.cb(result);
          }, 20);
        }
      };
    }

    think(state, opts, cb) {
      const id = this.nextId++;
      if (this.worker) {
        this.pending = { id, cb, state, opts };
        this.worker.postMessage({
          id,
          fen: E.toFen(state),
          level: opts.level,
          depth: opts.depth,
          timeMs: opts.timeMs
        });
        // Safety net: if the worker dies silently, answer on the main thread.
        clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => {
          if (!this.pending || this.pending.id !== id) return;
          const pending = this.pending;
          this.pending = null;
          const result = AC.Search.findBestMove(E.clone(pending.state), pending.opts);
          pending.cb(result);
        }, (opts.timeMs || 2000) + 5000);
      } else {
        const snapshot = E.clone(state);
        setTimeout(() => cb(AC.Search.findBestMove(snapshot, opts)), 30);
      }
    }
  }

  // ------------------------------------------------------------ position ids

  function initialIds(state) {
    const ids = new Int16Array(64);
    const meta = new Map();
    let next = 1;
    for (let sq = 0; sq < 64; sq++) {
      const p = state.board[sq];
      if (!p) continue;
      ids[sq] = next;
      meta.set(next, { type: Math.abs(p), color: p > 0 ? 1 : -1 });
      next++;
    }
    return { ids, meta };
  }

  function applyIds(state, ids, meta, move) {
    const from = move & 63;
    const to = (move >> 6) & 63;
    const promo = (move >> 12) & 7;
    const flags = move >> 15;
    const piece = state.board[from];
    const side = piece > 0 ? 1 : -1;

    let capSq = to;
    if (flags & C.F_EP) capSq = to - side * 8;
    const capId = ids[capSq];
    if (capId) {
      ids[capSq] = 0;
      meta.delete(capId);
    }

    const id = ids[from];
    ids[from] = 0;
    ids[to] = id;
    if (promo) {
      const info = meta.get(id);
      if (info) info.type = promo;
    }

    if (flags & C.F_CASTLE) {
      let rf;
      let rt;
      if (to === 6) { rf = 7; rt = 5; }
      else if (to === 2) { rf = 0; rt = 3; }
      else if (to === 62) { rf = 63; rt = 61; }
      else { rf = 56; rt = 59; }
      const rid = ids[rf];
      ids[rf] = 0;
      ids[rt] = rid;
    }
  }

  function buildPosition(index) {
    const state = E.fromFen(game.startFen);
    const { ids, meta } = initialIds(state);
    for (let i = 0; i < index; i++) {
      const move = game.moves[i].move;
      applyIds(state, ids, meta, move);
      E.makeMove(state, move);
    }
    return { state, ids, meta };
  }

  function stateAt(index) {
    const state = E.fromFen(game.startFen);
    for (let i = 0; i < index; i++) E.makeMove(state, game.moves[i].move);
    return state;
  }

  // ------------------------------------------------------------- game rules

  function movesFrom(sq) {
    const out = [];
    for (let i = 0; i < game.legal.length; i++) {
      if ((game.legal[i] & 63) === sq) out.push(game.legal[i]);
    }
    return out;
  }

  function isLive() {
    return game.viewIndex === game.moves.length;
  }

  function canHumanPlay() {
    if (game.over || game.thinking) return false;
    if (!isLive()) return false;
    if (game.mode === 'local') return true;
    if (game.mode === 'ai') return game.state.turn === game.humanSide;
    return false;
  }

  function aiShouldMove() {
    if (game.over) return false;
    if (game.mode === 'auto') return !game.autoPaused;
    if (game.mode === 'ai') return game.state.turn !== game.humanSide;
    return false;
  }

  // --------------------------------------------------------------- actions

  function newGame(opts) {
    opts = opts || {};
    clearTimeout(aiTimer);
    clearTimeout(hintTimer);
    game.reqId++;
    game.thinking = false;

    const fen = opts.fen || START;
    let state;
    try {
      state = E.fromFen(fen);
    } catch (err) {
      showToast('That FEN is not valid.');
      return;
    }

    game.startFen = fen;
    game.state = state;
    game.moves = [];
    game.mode = opts.mode || game.mode || 'ai';
    game.humanSide = opts.humanSide !== undefined ? opts.humanSide : 1;
    game.level = opts.level || game.level || 'medium';
    game.flipped = opts.flipped !== undefined
      ? opts.flipped
      : (game.mode === 'ai' && game.humanSide === -1);
    game.over = false;
    game.selectedSq = -1;
    game.viewIndex = 0;
    game.autoPaused = false;
    game.status = E.status(state);
    game.legal = game.status.moves;
    lastInfo = null;

    board.resetPieces();
    board.setFlipped(game.flipped);
    board.setHint(null);
    render();
    saveGame();
    scheduleAI(700);
  }

  function applyMove(move) {
    if (game.over) return;

    const san = E.moveToSan(game.state, move);
    const capture = E.isCapture(game.state, move);
    const promo = E.isPromotion(move);
    const from = move & 63;
    const to = (move >> 6) & 63;
    const uci = E.moveToUci(move);

    E.makeMove(game.state, move);
    game.moves.push({ move, san, uci });
    game.viewIndex = game.moves.length;
    game.selectedSq = -1;
    game.status = E.status(game.state);
    game.legal = game.status.moves;
    game.over = game.status.over;

    board.setHint(null);
    board.setSelection(-1, null);

    const inChk = !game.over && E.inCheck(game.state, game.state.turn);
    const mate = game.over && game.status.reason === 'checkmate';

    if (game.over) {
      const humanWon = game.status.winner !== 0 && game.status.winner === game.humanSide;
      AC.Sound.end(humanWon);
    } else if (inChk) {
      AC.Sound.check();
    } else if (capture) {
      AC.Sound.capture();
    } else {
      AC.Sound.move();
    }

    if (fx && settings.fx) {
      const po = {
        vx: board.visualX(to), vy: board.visualY(to),
        fx: board.visualX(from), fy: board.visualY(from)
      };
      if (mate) {
        const ks = game.state.kings[game.state.turn === 1 ? 0 : 1];
        fx.onMove('mate', Object.assign({}, po, { vx: board.visualX(ks), vy: board.visualY(ks) }));
      } else if (inChk) {
        const ks = game.state.kings[game.state.turn === 1 ? 0 : 1];
        fx.onMove('check', Object.assign({}, po, { vx: board.visualX(ks), vy: board.visualY(ks) }));
      } else if (capture) {
        fx.onMove('capture', po);
      } else if (promo) {
        fx.onMove('promote', po);
      } else {
        fx.onMove('move', po);
      }
    }

    if (fx && settings.quips) {
      if (mate) fx.onQuip('mate');
      else if (inChk) fx.onQuip('check');
      else if (promo) fx.onQuip('promote');
      else if (capture) fx.onQuip('capture');
    }

    if (settings.haptics && navigator.vibrate) {
      if (mate) navigator.vibrate([30, 60, 30, 60, 60]);
      else if (inChk) navigator.vibrate([25, 45, 25]);
      else if (capture) navigator.vibrate(22);
      else navigator.vibrate(8);
    }

    render();
    saveGame();

    if (game.over) {
      const at = game.moves.length;
      setTimeout(() => {
        if (game.over && game.moves.length === at) showGameOver();
      }, mate ? 1250 : 420);
      return;
    }
    scheduleAI();
  }

  function playMoves(moves) {
    if (!moves.length) return;
    if (moves.length > 1 || E.isPromotion(moves[0])) {
      showPromotion(moves);
      return;
    }
    applyMove(moves[0]);
  }

  function undo() {
    if (!game.moves.length) return;
    clearTimeout(aiTimer);
    clearTimeout(hintTimer);
    game.reqId++;
    game.thinking = false;
    game.hintBusy = false;
    els.btnHint.classList.remove('busy');

    let count = 1;
    if (game.mode === 'ai' && game.state.turn === game.humanSide && game.moves.length >= 2) {
      count = 2;
    }
    count = Math.min(count, game.moves.length);
    game.moves.length -= count;
    game.state = stateAt(game.moves.length);
    game.viewIndex = game.moves.length;
    game.selectedSq = -1;
    game.over = false;
    game.status = E.status(game.state);
    game.legal = game.status.moves;

    board.setHint(null);
    board.setSelection(-1, null);
    AC.Sound.click();
    render();
    saveGame();
    scheduleAI(450);
  }

  function flip() {
    game.flipped = !game.flipped;
    board.setFlipped(game.flipped);
    renderPlayers(buildPosition(game.viewIndex).state);
    AC.Sound.click();
    saveGame();
  }

  function setView(index) {
    if (game.thinking) return;
    const target = Math.max(0, Math.min(index, game.moves.length));
    if (target === game.viewIndex) return;
    game.viewIndex = target;
    game.selectedSq = -1;
    board.setSelection(-1, null);
    AC.Sound.click();
    render();
  }

  function hint() {
    if (!canHumanPlay() || game.hintBusy) return;
    game.hintBusy = true;
    els.btnHint.classList.add('busy');
    AC.Sound.click();

    const fen = E.toFen(game.state);
    engine.think(game.state, { level: 'hard', timeMs: 1200 }, (result) => {
      game.hintBusy = false;
      els.btnHint.classList.remove('busy');
      if (!result || !result.move) return;
      if (E.toFen(game.state) !== fen) return;
      board.setHint(result.move & 63, (result.move >> 6) & 63);
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => board.setHint(null), 2800);
    });
  }

  function toggleAuto() {
    game.autoPaused = !game.autoPaused;
    els.btnAuto.querySelector('span').textContent = game.autoPaused ? 'Resume' : 'Pause';
    els.btnAuto.querySelector('svg').innerHTML = game.autoPaused
      ? '<path d="M8 5v14l11-7z"/>'
      : '<path d="M8 5v14M16 5v14"/>';
    if (!game.autoPaused) scheduleAI(250);
    renderStatus();
    AC.Sound.click();
  }

  // ------------------------------------------------------------------- AI

  function scheduleAI(delay) {
    clearTimeout(aiTimer);
    if (!aiShouldMove() || !isLive()) return;
    aiTimer = setTimeout(runAI, delay === undefined ? 260 : delay);
  }

  function runAI() {
    if (game.thinking || !aiShouldMove() || !isLive()) return;

    game.thinking = true;
    game.selectedSq = -1;
    board.setSelection(-1, null);
    renderStatus();

    const token = ++game.reqId;
    const fen = E.toFen(game.state);
    const side = game.state.turn;

    engine.think(game.state, { level: game.level }, (result) => {
      if (token !== game.reqId) return;
      if (E.toFen(game.state) !== fen) {
        game.thinking = false;
        renderStatus();
        return;
      }

      game.thinking = false;

      if (!result || !result.move) {
        renderStatus();
        return;
      }

      lastInfo = {
        depth: result.depth,
        nodes: result.nodes,
        timeMs: result.timeMs,
        score: result.score,
        whiteScore: side === 1 ? result.score : -result.score
      };

      applyMove(result.move);
    });
  }

  // --------------------------------------------------------------- render

  function render() {
    const index = Math.min(game.viewIndex, game.moves.length);
    const pos = buildPosition(index);

    board.setPosition(pos.state, pos.ids, pos.meta);

    const last = index > 0 ? game.moves[index - 1].move : null;
    board.setLastMove(last === null ? null : (last & 63), last === null ? null : ((last >> 6) & 63));

    const check = E.inCheck(pos.state, pos.state.turn);
    board.setCheck(check ? pos.state.kings[pos.state.turn === 1 ? 0 : 1] : -1);

    if (game.selectedSq >= 0 && isLive()) {
      board.setSelection(game.selectedSq, movesFrom(game.selectedSq));
    } else {
      board.setSelection(-1, null);
    }

    board.setInteractive(canHumanPlay());
    renderPlayers(pos.state);
    renderMoveList();
    renderStatus();
    renderMeta();
    renderEngineInfo();
    els.btnLive.hidden = isLive();
    els.btnUndo.disabled = game.moves.length === 0;
    if (els.handleCount) els.handleCount.textContent = String(game.moves.length);
  }

  function playerInfo(side) {
    if (game.mode === 'ai') {
      if (side === game.humanSide) {
        return {
          name: 'You',
          sub: side === 1 ? 'White' : 'Black',
          avatar: 'YOU',
          human: true
        };
      }
      return {
        name: 'Agent',
        sub: LEVEL_LABEL[game.level] + (game.thinking ? ' · thinking' : ''),
        avatar: 'AI',
        human: false
      };
    }
    if (game.mode === 'local') {
      return {
        name: side === 1 ? 'White' : 'Black',
        sub: 'Local player',
        avatar: side === 1 ? 'W' : 'B',
        human: true
      };
    }
    return {
      name: 'Agent ' + (side === 1 ? 'White' : 'Black'),
      sub: game.autoPaused ? 'Paused' : 'Auto-play',
      avatar: 'AI',
      human: false
    };
  }

  function capturedFor(state, bySide) {
    const start = E.fromFen(game.startFen);
    const wanted = -bySide;
    const startCount = {};
    const nowCount = {};
    for (let sq = 0; sq < 64; sq++) {
      const p = start.board[sq];
      if (p && (p > 0 ? 1 : -1) === wanted) {
        const t = Math.abs(p);
        startCount[t] = (startCount[t] || 0) + 1;
      }
      const q = state.board[sq];
      if (q && (q > 0 ? 1 : -1) === wanted) {
        const t = Math.abs(q);
        nowCount[t] = (nowCount[t] || 0) + 1;
      }
    }
    const out = [];
    for (const t of [5, 4, 3, 2, 1]) {
      const missing = (startCount[t] || 0) - (nowCount[t] || 0);
      for (let i = 0; i < missing; i++) out.push(t);
    }
    return out;
  }

  function materialScore(state) {
    let white = 0;
    let black = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = state.board[sq];
      if (!p) continue;
      const t = Math.abs(p);
      if (t === C.KING) continue;
      if (p > 0) white += C.VALUE[t];
      else black += C.VALUE[t];
    }
    return white - black;
  }

  function renderPlayers(state) {
    const bottomSide = game.flipped ? -1 : 1;
    const topSide = -bottomSide;
    const top = playerInfo(topSide);
    const bottom = playerInfo(bottomSide);

    els.opponentName.textContent = top.name;
    els.opponentSub.textContent = top.sub;
    els.opponentAvatar.textContent = top.avatar;
    els.opponentAvatar.classList.toggle('human', top.human);

    els.playerName.textContent = bottom.name;
    els.playerSub.textContent = bottom.sub;
    els.playerAvatar.textContent = bottom.avatar;
    els.playerAvatar.classList.toggle('human', bottom.human);

    const balance = materialScore(state);

    renderCaptured(els.opponentCaptured, capturedFor(state, topSide), -topSide);
    renderCaptured(els.playerCaptured, capturedFor(state, bottomSide), -bottomSide);

    els.opponentMaterial.textContent = topSide === 1
      ? (balance > 0 ? '+' + Math.round(balance / 100) : '')
      : (balance < 0 ? '+' + Math.round(-balance / 100) : '');
    els.playerMaterial.textContent = bottomSide === 1
      ? (balance > 0 ? '+' + Math.round(balance / 100) : '')
      : (balance < 0 ? '+' + Math.round(-balance / 100) : '');

    els.opponentBar.classList.toggle('active', !game.over && state.turn === topSide);
    els.playerBar.classList.toggle('active', !game.over && state.turn === bottomSide);
  }

  function renderCaptured(el, types, color) {
    el.innerHTML = '';
    for (const type of types) {
      const img = document.createElement('img');
      img.src = AC.pieceSrc(type, color);
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
    }
  }

  function renderMoveList() {
    els.moveList.innerHTML = '';
    const total = game.moves.length;
    for (let i = 0; i < total; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = (i / 2 + 1) + '.';
      row.appendChild(num);

      for (let j = 0; j < 2; j++) {
        const ply = i + j;
        if (ply >= total) {
          const spacer = document.createElement('span');
          spacer.className = 'san spacer';
          row.appendChild(spacer);
          continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'san';
        btn.textContent = game.moves[ply].san;
        btn.dataset.ply = String(ply + 1);
        if (ply + 1 === game.viewIndex) btn.classList.add('active');
        row.appendChild(btn);
      }

      els.moveList.appendChild(row);
    }

    els.moveEmpty.hidden = total > 0;

    if (isLive()) {
      const wrap = els.moveList.parentElement;
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  function renderStatus() {
    const live = isLive();
    els.status.classList.remove('check', 'over');

    if (!live) {
      els.status.textContent = `Reviewing move ${game.viewIndex} of ${game.moves.length}`;
      return;
    }
    if (game.over) {
      const reason = game.status.reason;
      let text;
      if (reason === 'checkmate') {
        text = (game.status.winner === 1 ? 'White' : 'Black') + ' wins by checkmate';
      } else if (reason === 'stalemate') {
        text = 'Draw by stalemate';
      } else if (reason === 'fifty-move') {
        text = 'Draw by fifty-move rule';
      } else if (reason === 'insufficient') {
        text = 'Draw by insufficient material';
      } else {
        text = 'Game over';
      }
      els.status.textContent = text;
      els.status.classList.add('over');
      return;
    }

    const side = game.state.turn === 1 ? 'White' : 'Black';
    let suffix = '';
    if (game.mode === 'ai') {
      suffix = game.state.turn === game.humanSide ? ' · your move' : ' · agent to move';
    } else if (game.mode === 'local') {
      suffix = ' · local';
    } else {
      suffix = game.autoPaused ? ' · paused' : ' · auto-play';
    }
    if (game.thinking) suffix = ' · agent is thinking';

    els.status.textContent = side + ' to move' + suffix;

    if (E.inCheck(game.state, game.state.turn)) {
      els.status.classList.add('check');
      els.status.textContent = side + ' is in check' + suffix;
    }
  }

  function renderMeta() {
    const modes = { ai: 'Play with Bot', local: 'Classic', auto: 'Agent vs Agent' };
    els.metaMode.textContent = modes[game.mode] || 'Vs Agent';
    els.metaLevel.textContent = LEVEL_LABEL[game.level] || 'Medium';
    els.btnAuto.classList.toggle('hidden', game.mode !== 'auto');
    els.btnAuto.querySelector('span').textContent = game.autoPaused ? 'Resume' : 'Pause';
    els.btnAuto.querySelector('svg').innerHTML = game.autoPaused
      ? '<path d="M8 5v14l11-7z"/>'
      : '<path d="M8 5v14M16 5v14"/>';
  }

  function renderEngineInfo() {
    if (!lastInfo) {
      els.engineChip.textContent = 'engine ready';
      els.engineRow.innerHTML = '<span>depth —</span><span>nodes —</span><span>time —</span>';
      els.evalNum.textContent = '0.00';
      els.evalFill.style.width = '50%';
      return;
    }

    els.engineChip.textContent = 'd' + lastInfo.depth + ' · ' +
      (lastInfo.nodes / 1000).toFixed(1) + 'k · ' +
      (lastInfo.timeMs / 1000).toFixed(2) + 's';

    els.engineRow.innerHTML =
      '<span>depth ' + lastInfo.depth + '</span>' +
      '<span>nodes ' + lastInfo.nodes.toLocaleString('en-US') + '</span>' +
      '<span>time ' + (lastInfo.timeMs / 1000).toFixed(2) + 's</span>';

    const white = lastInfo.whiteScore || 0;
    els.evalNum.textContent = (white >= 0 ? '+' : '') + (white / 100).toFixed(2);
    const pct = 50 + 50 * Math.tanh(white / 400);
    els.evalFill.style.width = pct.toFixed(1) + '%';
  }

  // ------------------------------------------------------------- selection

  function selectSquare(sq) {
    game.selectedSq = sq;
    board.setSelection(sq, movesFrom(sq));
  }

  function clearSelection() {
    game.selectedSq = -1;
    board.setSelection(-1, null);
  }

  // -------------------------------------------------------------- pointer

  function onDown(sq, event) {
    if (!canHumanPlay()) return;
    const piece = game.state.board[sq];
    const side = piece > 0 ? 1 : -1;

    if (game.selectedSq >= 0) {
      const candidates = movesFrom(game.selectedSq).filter((m) => ((m >> 6) & 63) === sq);
      if (candidates.length) {
        clearSelection();
        playMoves(candidates);
        return;
      }
    }

    if (piece && side === game.state.turn) {
      game.tapWasSelected = game.selectedSq === sq;
      selectSquare(sq);
      board.startDrag(event, sq);
    } else {
      game.tapWasSelected = false;
      clearSelection();
    }
  }

  function onUp(from, to, moved, event) {
    if (!canHumanPlay()) {
      board.endDrag(null);
      return;
    }
    if (from < 0) {
      board.endDrag(null);
      return;
    }

    if (!moved) {
      board.endDrag(null);
      if (to === from) {
        if (game.tapWasSelected) {
          clearSelection();
          game.tapWasSelected = false;
        }
      } else if (game.selectedSq === from && to >= 0) {
        const candidates = movesFrom(from).filter((m) => ((m >> 6) & 63) === to);
        if (candidates.length) {
          clearSelection();
          playMoves(candidates);
        }
      }
      return;
    }

    const candidates = from >= 0 && to >= 0
      ? movesFrom(from).filter((m) => ((m >> 6) & 63) === to)
      : [];

    if (candidates.length) {
      board.endDrag(to);
      clearSelection();
      playMoves(candidates);
    } else {
      board.endDrag(null);
      if (to >= 0 && to !== from) AC.Sound.error();
      if (game.selectedSq === from) board.setSelection(from, movesFrom(from));
    }
    void event;
  }

  // -------------------------------------------------------------- promotion

  function showPromotion(moves) {
    const side = game.state.turn;
    const options = [C.QUEEN, C.ROOK, C.BISHOP, C.KNIGHT];
    const html = `
      <div class="modal-head">
        <h3>Promote pawn</h3>
        <button class="icon-btn" data-close type="button" aria-label="Cancel">×</button>
      </div>
      <p class="modal-note">Choose the piece your pawn becomes.</p>
      <div class="promo-grid">
        ${options.map((type) => `
          <button class="promo-btn" type="button" data-promo="${type}">
            <img src="${AC.pieceSrc(type, side)}" alt="${C.PIECE_LETTER[type]}">
            <span>${type === C.QUEEN ? 'Queen' : type === C.ROOK ? 'Rook' : type === C.BISHOP ? 'Bishop' : 'Knight'}</span>
          </button>`).join('')}
      </div>`;

    const modal = openModal(html);
    modal.querySelectorAll('[data-promo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = Number(btn.dataset.promo);
        const move = moves.find((m) => ((m >> 12) & 7) === type) || moves[0];
        closeModal();
        applyMove(move);
      });
    });
  }

  // ------------------------------------------------------------------ modals

  let modalCleanup = null;

  function openModal(html) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = html;
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const onBackdrop = (e) => {
      if (e.target === backdrop) closeModal();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    backdrop.addEventListener('pointerdown', onBackdrop);
    document.addEventListener('keydown', onKey);

    modal.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });

    modalCleanup = () => {
      document.removeEventListener('keydown', onKey);
    };

    return modal;
  }

  function closeModal() {
    if (modalCleanup) {
      modalCleanup();
      modalCleanup = null;
    }
    const backdrop = els.modalRoot.querySelector('.modal-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 160);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  // ------------------------------------------------------------- new game UI

  function openNewGame() {
    const modal = openModal(`
      <div class="modal-head">
        <h3>New game</h3>
        <button class="icon-btn" data-close type="button" aria-label="Close">×</button>
      </div>

      <div class="field">
        <span class="field-label">Mode</span>
        <div class="segmented" data-group="mode">
          <button type="button" data-value="ai" class="active">Vs Agent</button>
          <button type="button" data-value="local">2 Players</button>
          <button type="button" data-value="auto">Agent vs Agent</button>
        </div>
      </div>

      <div class="field" data-when="ai">
        <span class="field-label">Play as</span>
        <div class="segmented" data-group="side">
          <button type="button" data-value="1" class="active">White</button>
          <button type="button" data-value="-1">Black</button>
          <button type="button" data-value="0">Random</button>
        </div>
      </div>

      <div class="field" data-when="ai auto">
        <span class="field-label">Difficulty</span>
        <div class="segmented" data-group="level">
          <button type="button" data-value="easy">Easy</button>
          <button type="button" data-value="medium" class="active">Medium</button>
          <button type="button" data-value="hard">Hard</button>
          <button type="button" data-value="expert">Expert</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>Cancel</button>
        <button class="btn primary" type="button" id="modal-start">Start game</button>
      </div>
    `);

    const modeGroup = modal.querySelector('[data-group="mode"]');
    const sideGroup = modal.querySelector('[data-group="side"]');
    const levelGroup = modal.querySelector('[data-group="level"]');

    const refreshFields = () => {
      const mode = modeGroup.querySelector('.active').dataset.value;
      modal.querySelectorAll('[data-when]').forEach((field) => {
        field.hidden = !field.dataset.when.split(' ').includes(mode);
      });
    };

    modal.querySelectorAll('.segmented').forEach((group) => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        group.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        AC.Sound.click();
        refreshFields();
      });
    });

    refreshFields();

    modal.querySelector('#modal-start').addEventListener('click', () => {
      const mode = modeGroup.querySelector('.active').dataset.value;
      const level = levelGroup.querySelector('.active').dataset.value;
      let side = Number(sideGroup.querySelector('.active').dataset.value);
      if (side === 0) side = Math.random() < 0.5 ? 1 : -1;

      closeModal();
      newGame({
        mode,
        level,
        humanSide: mode === 'ai' ? side : 1,
        flipped: mode === 'ai' ? side === -1 : false
      });
    });
  }

  // ---------------------------------------------------------------- settings

  function openSettings() {
    const themes = [
      { id: 'vitrine', name: 'Pearl Vitrine' },
      { id: 'obsidian', name: 'Obsidian' },
      { id: 'aurora', name: 'Aurora' }
    ];

    const modal = openModal(`
      <div class="modal-head">
        <h3>Settings</h3>
        <button class="icon-btn" data-close type="button" aria-label="Close">×</button>
      </div>

      <div class="setting-row">
        <div><strong>Sound</strong><small>Move, capture and check cues</small></div>
        <button class="switch ${settings.sound ? 'on' : ''}" type="button" data-toggle="sound" aria-pressed="${settings.sound}"><i></i></button>
      </div>

      <div class="setting-row">
        <div><strong>Coordinates</strong><small>Files and ranks on the board</small></div>
        <button class="switch ${settings.coords ? 'on' : ''}" type="button" data-toggle="coords" aria-pressed="${settings.coords}"><i></i></button>
      </div>

      <div class="setting-row">
        <div><strong>Cinematic FX</strong><small>Explosions, shake and check stamps</small></div>
        <button class="switch ${settings.fx ? 'on' : ''}" type="button" data-toggle="fx" aria-pressed="${settings.fx}"><i></i></button>
      </div>

      <div class="setting-row">
        <div><strong>Subtitles</strong><small>Pieces talk back after big moments</small></div>
        <button class="switch ${settings.quips ? 'on' : ''}" type="button" data-toggle="quips" aria-pressed="${settings.quips}"><i></i></button>
      </div>

      <div class="setting-row">
        <div><strong>Vibration</strong><small>Haptic feedback on moves</small></div>
        <button class="switch ${settings.haptics ? 'on' : ''}" type="button" data-toggle="haptics" aria-pressed="${settings.haptics}"><i></i></button>
      </div>

      <div class="field">
        <span class="field-label">Board theme</span>
        <div class="theme-grid">
          ${themes.map((t) => `
            <button class="theme-swatch ${settings.theme === t.id ? 'active' : ''}" type="button" data-theme="${t.id}">
              <span class="swatch ${t.id}" aria-hidden="true"></span>
              <span>${t.name}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Position</span>
        <div class="io-row">
          <button class="btn ghost" type="button" data-copy="fen">Copy FEN</button>
          <button class="btn ghost" type="button" data-copy="pgn">Copy PGN</button>
        </div>
        <textarea id="import-box" class="import-box" rows="3" placeholder="Paste a FEN or PGN here…" spellcheck="false"></textarea>
        <button class="btn ghost wide" type="button" id="btn-import">Load position</button>
      </div>

      <div class="about">
        <strong>Agent Chess v1.0</strong>
        <span>FIDE rules · perft verified · hand-written negamax engine.</span>
        <span>No chess.js, no Stockfish, no frameworks.</span>
      </div>
    `);

    modal.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        settings[key] = !settings[key];
        btn.classList.toggle('on', settings[key]);
        btn.setAttribute('aria-pressed', String(settings[key]));
        applySettings();
        AC.Sound.click();
      });
    });

    modal.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.theme = btn.dataset.theme;
        modal.querySelectorAll('.theme-swatch').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings();
        AC.Sound.click();
      });
    });

    modal.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copy === 'fen' ? E.toFen(game.state) : buildPgn();
        copyText(text).then(() => showToast('Copied to clipboard.')).catch(() => showToast('Copy failed.'));
      });
    });

    modal.querySelector('#btn-import').addEventListener('click', () => {
      const text = modal.querySelector('#import-box').value;
      if (!text.trim()) {
        showToast('Paste a FEN or PGN first.');
        return;
      }
      if (importText(text)) {
        closeModal();
        showToast('Position loaded.');
      } else {
        showToast('Could not read that position.');
      }
    });
  }

  // ------------------------------------------------------------------- PGN

  function buildPgn() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const result = game.status ? game.status.result : '*';
    const white = game.mode === 'ai'
      ? (game.humanSide === 1 ? 'Player' : 'Agent')
      : game.mode === 'auto' ? 'Agent' : 'White';
    const black = game.mode === 'ai'
      ? (game.humanSide === -1 ? 'Player' : 'Agent')
      : game.mode === 'auto' ? 'Agent' : 'Black';

    const headers = [
      '[Event "Agent Chess"]',
      '[Site "Local"]',
      `[Date "${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}"]`,
      '[Round "-"]',
      `[White "${white}"]`,
      `[Black "${black}"]`,
      `[Result "${result}"]`
    ];
    if (game.startFen !== START) {
      headers.push('[SetUp "1"]');
      headers.push(`[FEN "${game.startFen}"]`);
    }

    let body = '';
    for (let i = 0; i < game.moves.length; i++) {
      if (i % 2 === 0) body += (i / 2 + 1) + '. ';
      body += game.moves[i].san + ' ';
    }
    body += result;

    const wrapped = [];
    let line = '';
    for (const token of body.split(' ')) {
      if ((line + token).length > 78) {
        wrapped.push(line.trim());
        line = '';
      }
      line += token + ' ';
    }
    if (line.trim()) wrapped.push(line.trim());

    return headers.join('\n') + '\n\n' + wrapped.join('\n') + '\n';
  }

  function importText(text) {
    const raw = String(text).trim();
    if (!raw) return false;

    const looksPgn = raw.includes('[') || /\d+\./.test(raw);
    let startFen = START;
    let tokens = null;

    if (looksPgn) {
      const fenMatch = raw.match(/\[FEN\s+"([^"]+)"\]/i);
      if (fenMatch) startFen = fenMatch[1];
      const body = raw
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/;[^\n]*/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\$\d+/g, ' ')
        .replace(/\d+\.(\.\.)?/g, ' ');
      tokens = body.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    } else {
      startFen = raw.split('\n')[0].trim();
    }

    let state;
    try {
      state = E.fromFen(startFen);
    } catch (err) {
      return false;
    }

    const moves = [];
    if (tokens) {
      for (const token of tokens) {
        const move = E.moveFromSan(state, token);
        if (!move) break;
        moves.push({ move, san: E.moveToSan(state, move), uci: E.moveToUci(move) });
        E.makeMove(state, move);
      }
      if (!moves.length && tokens.length) return false;
    }

    clearTimeout(aiTimer);
    game.reqId++;
    game.thinking = false;
    game.startFen = startFen;
    game.moves = moves;
    game.state = E.fromFen(startFen);
    for (const rec of moves) E.makeMove(game.state, rec.move);
    game.viewIndex = moves.length;
    game.selectedSq = -1;
    game.over = false;
    game.status = E.status(game.state);
    game.legal = game.status.moves;
    game.over = game.status.over;
    lastInfo = null;

    board.resetPieces();
    board.setHint(null);
    render();
    saveGame();
    if (!game.over) scheduleAI(600);
    return true;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ------------------------------------------------------------------ game over

  function showGameOver() {
    const status = game.status;
    let title = 'Game over';
    let note = '';
    if (status.reason === 'checkmate') {
      title = (status.winner === 1 ? 'White' : 'Black') + ' wins';
      note = 'Checkmate.';
    } else if (status.reason === 'stalemate') {
      title = 'Draw';
      note = 'Stalemate — no legal moves.';
    } else if (status.reason === 'fifty-move') {
      title = 'Draw';
      note = 'Fifty-move rule.';
    } else if (status.reason === 'insufficient') {
      title = 'Draw';
      note = 'Insufficient material.';
    }

    const modal = openModal(`
      <div class="result-hero">
        <span class="result-kicker">${status.result}</span>
        <h3>${title}</h3>
        <p>${note}</p>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>Review</button>
        <button class="btn primary" type="button" id="result-rematch">Rematch</button>
      </div>
    `);

    modal.querySelector('#result-rematch').addEventListener('click', () => {
      closeModal();
      newGame({
        mode: game.mode,
        level: game.level,
        humanSide: game.humanSide,
        flipped: game.flipped
      });
    });
  }

  // ------------------------------------------------------------------ saving

  function saveGame() {
    try {
      const payload = {
        startFen: game.startFen,
        moves: game.moves.map((m) => m.uci),
        mode: game.mode,
        humanSide: game.humanSide,
        level: game.level,
        flipped: game.flipped,
        ts: Date.now()
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch (err) {
      /* storage may be disabled */
    }
  }

  function loadGame() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch (err) {
      return false;
    }
    if (!data || !Array.isArray(data.moves)) return false;

    try {
      const startFen = data.startFen || START;
      const state = E.fromFen(startFen);
      const moves = [];
      for (const uci of data.moves) {
        const move = E.moveFromUci(state, uci);
        if (!move) return false;
        moves.push({ move, san: E.moveToSan(state, move), uci });
        E.makeMove(state, move);
      }

      game.startFen = startFen;
      game.moves = moves;
      game.state = E.fromFen(startFen);
      for (const rec of moves) E.makeMove(game.state, rec.move);
      game.mode = data.mode === 'local' || data.mode === 'auto' ? data.mode : 'ai';
      game.humanSide = data.humanSide === -1 ? -1 : 1;
      game.level = LEVEL_LABEL[data.level] ? data.level : 'medium';
      game.flipped = Boolean(data.flipped);
      game.viewIndex = moves.length;
      game.selectedSq = -1;
      game.over = false;
      game.status = E.status(game.state);
      game.legal = game.status.moves;
      game.over = game.status.over;
      lastInfo = null;
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadSettings() {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!data) return;
      if (typeof data.sound === 'boolean') settings.sound = data.sound;
      if (typeof data.coords === 'boolean') settings.coords = data.coords;
      if (typeof data.fx === 'boolean') settings.fx = data.fx;
      if (typeof data.quips === 'boolean') settings.quips = data.quips;
      if (typeof data.haptics === 'boolean') settings.haptics = data.haptics;
      if (['vitrine', 'obsidian', 'aurora'].includes(data.theme)) settings.theme = data.theme;
    } catch (err) {
      /* ignore */
    }
  }

  function applySettings() {
    document.documentElement.dataset.board = settings.theme;
    AC.Sound.setEnabled(settings.sound);
    board.setCoords(settings.coords);
    els.btnSound.classList.toggle('off', !settings.sound);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------- init

  function bind() {
    els.btnNew.addEventListener('click', () => {
      AC.Sound.click();
      openNewGame();
    });
    els.btnUndo.addEventListener('click', undo);
    els.btnFlip.addEventListener('click', flip);
    els.btnHint.addEventListener('click', hint);
    els.btnAuto.addEventListener('click', toggleAuto);
    els.btnSettings.addEventListener('click', () => {
      AC.Sound.click();
      openSettings();
    });
    els.btnSound.addEventListener('click', () => {
      settings.sound = !settings.sound;
      applySettings();
      if (settings.sound) AC.Sound.click();
    });
    els.btnCopyPgn.addEventListener('click', () => {
      copyText(buildPgn())
        .then(() => showToast('PGN copied.'))
        .catch(() => showToast('Copy failed.'));
    });
    els.btnLive.addEventListener('click', () => setView(game.moves.length));

    els.btnPanel.addEventListener('click', () => {
      AC.Sound.click();
      const collapsed = els.panel.classList.toggle('collapsed');
      els.btnPanel.setAttribute('aria-expanded', String(!collapsed));
    });

    els.moveList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-ply]');
      if (!btn) return;
      setView(Number(btn.dataset.ply));
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setView(game.viewIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setView(game.viewIndex + 1);
      } else if (e.key === 'f') {
        flip();
      } else if (e.key === 'u') {
        undo();
      } else if (e.key === 'n') {
        openNewGame();
      }
    });

    document.addEventListener('pointerdown', () => AC.Sound.unlock(), { once: true });
  }

  function initEmbers() {
    if (!els.embers) return;
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      const size = 1 + Math.random() * 2.4;
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.width = size.toFixed(1) + 'px';
      s.style.height = size.toFixed(1) + 'px';
      s.style.animationDuration = (9 + Math.random() * 11).toFixed(1) + 's';
      s.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's';
      s.style.setProperty('--drift', (Math.random() * 90 - 45).toFixed(0) + 'px');
      els.embers.appendChild(s);
    }
  }

  function showSplash() {
    if (!els.splash) return;
    const hide = () => els.splash.classList.add('hide');
    const timer = setTimeout(hide, 1700);
    els.splash.addEventListener('pointerdown', () => {
      clearTimeout(timer);
      hide();
    }, { once: true });
  }

  function init() {
    loadSettings();
    board = new AC.BoardView(els.board);
    board.onDown = onDown;
    board.onUp = onUp;
    fx = new AC.FX(els.board, els.stage, els.quip, els.subtitle);
    engine = new EngineClient();

    initEmbers();
    bind();
    applySettings();

    const restored = loadGame();
    if (restored) {
      board.setFlipped(game.flipped);
      render();
      if (!game.over) scheduleAI(800);
    } else {
      newGame({ mode: 'ai', humanSide: 1, level: 'medium' });
    }
    showSplash();
  }

  // Small surface for the stage shell (intro, transport, mode sheets).
  AC.App = {
    newGame,
    undo,
    flip,
    hint,
    openNewGame,
    openSettings,
    showToast,
    getGame: () => game
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
