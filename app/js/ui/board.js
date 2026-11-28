/* Agent Chess — board rendering, piece animation and pointer input. */
(function (AC) {
  'use strict';

  const C = AC.C;
  const TYPE_NAMES = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };

  function pieceSrc(type, color) {
    const key = TYPE_NAMES[type] + '-' + (color > 0 ? 'w' : 'b');
    if (window.AC_PIECE_DATA && window.AC_PIECE_DATA[key]) return window.AC_PIECE_DATA[key];
    return 'assets/pieces/' + key + '.png';
  }

  class BoardView {
    constructor(root) {
      this.root = root;
      this.squaresEl = root.querySelector('.squares');
      this.piecesEl = root.querySelector('.pieces');

      this.squareEls = new Array(64);
      this.pieceEls = new Map();
      this.ids = new Int16Array(64);
      this.meta = new Map();

      this.flipped = false;
      this.selected = -1;
      this.targets = new Map();
      this.lastMove = null;
      this.checkSq = -1;
      this.hint = null;
      this.coords = true;

      this.drag = null;
      this.pointerId = null;
      this.downSq = -1;
      this.moved = false;

      this.onDown = null;
      this.onUp = null;

      this.buildSquares();
      this.bindPointer();
    }

    // ------------------------------------------------------------- geometry

    visualX(sq) {
      return this.flipped ? 7 - (sq & 7) : (sq & 7);
    }

    visualY(sq) {
      return this.flipped ? (sq >> 3) : 7 - (sq >> 3);
    }

    squareFromPoint(clientX, clientY) {
      const rect = this.root.getBoundingClientRect();
      const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
      const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
      return this.flipped ? (y * 8 + (7 - x)) : ((7 - y) * 8 + x);
    }

    // -------------------------------------------------------------- squares

    buildSquares() {
      this.squaresEl.innerHTML = '';
      this.squareEls = new Array(64);

      for (let vy = 0; vy < 8; vy++) {
        for (let vx = 0; vx < 8; vx++) {
          const sq = this.flipped ? (vy * 8 + (7 - vx)) : ((7 - vy) * 8 + vx);
          const color = ((sq & 7) + (sq >> 3)) % 2 === 0 ? 'dark' : 'light';
          const el = document.createElement('div');
          el.className = 'sq ' + color;
          el.dataset.sq = String(sq);
          el.dataset.color = color;
          el.setAttribute('role', 'gridcell');
          el.setAttribute('aria-label', C.SQUARE_NAMES[sq]);

          if (vy === 7) {
            const file = document.createElement('span');
            file.className = 'coord coord-file';
            file.textContent = C.FILES[sq & 7];
            el.appendChild(file);
          }
          if (vx === 0) {
            const rank = document.createElement('span');
            rank.className = 'coord coord-rank';
            rank.textContent = String((sq >> 3) + 1);
            el.appendChild(rank);
          }

          this.squaresEl.appendChild(el);
          this.squareEls[sq] = el;
        }
      }
      this.root.classList.toggle('no-coords', !this.coords);
    }

    setFlipped(flipped) {
      this.flipped = Boolean(flipped);
      this.buildSquares();
      this.renderPieces();
      this.renderHighlights();
    }

    setCoords(show) {
      this.coords = Boolean(show);
      this.root.classList.toggle('no-coords', !this.coords);
    }

    setInteractive(value) {
      this.root.classList.toggle('interactive', Boolean(value));
    }

    // --------------------------------------------------------------- pieces

    setPosition(state, ids, meta) {
      this.state = state;
      this.ids = ids;
      this.meta = meta;
      this.renderPieces();
      this.renderHighlights();
    }

    resetPieces() {
      this.piecesEl.innerHTML = '';
      this.pieceEls.clear();
      this.ids = new Int16Array(64);
      this.meta = new Map();
    }

    renderPieces() {
      const seen = new Set();

      for (let sq = 0; sq < 64; sq++) {
        const id = this.ids[sq];
        if (!id) continue;
        seen.add(id);

        const info = this.meta.get(id);
        if (!info) continue;

        let el = this.pieceEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'piece';
          el.dataset.id = String(id);
          const img = document.createElement('img');
          img.draggable = false;
          img.alt = '';
          el.appendChild(img);
          el.style.setProperty('--x', String(this.visualX(sq)));
          el.style.setProperty('--y', String(this.visualY(sq)));
          this.piecesEl.appendChild(el);
          this.pieceEls.set(id, el);
        }

        const src = pieceSrc(info.type, info.color);
        const img = el.firstChild;
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        el.classList.toggle('black', info.color < 0);
        el.classList.toggle('king', info.type === 6);
        el.style.setProperty('--x', String(this.visualX(sq)));
        el.style.setProperty('--y', String(this.visualY(sq)));
      }

      for (const [id, el] of Array.from(this.pieceEls.entries())) {
        if (!seen.has(id)) {
          el.remove();
          this.pieceEls.delete(id);
        }
      }
    }

    // ------------------------------------------------------------ highlight

    setSelection(sq, moves) {
      this.selected = sq;
      this.targets = new Map();
      if (sq >= 0 && moves) {
        for (let i = 0; i < moves.length; i++) {
          const m = moves[i];
          const to = (m >> 6) & 63;
          const flags = m >> 15;
          const capture = Boolean(this.state && (this.state.board[to] || (flags & C.F_EP)));
          this.targets.set(to, capture);
        }
      }
      this.renderHighlights();
    }

    setLastMove(from, to) {
      this.lastMove = from === undefined || from === null ? null : [from, to];
      this.renderHighlights();
    }

    setCheck(sq) {
      this.checkSq = sq === undefined || sq === null ? -1 : sq;
      this.renderHighlights();
    }

    setHint(from, to) {
      this.hint = from === undefined || from === null ? null : [from, to];
      this.renderHighlights();
    }

    renderHighlights() {
      for (let sq = 0; sq < 64; sq++) {
        const el = this.squareEls[sq];
        if (!el) continue;
        let cls = 'sq ' + el.dataset.color;
        if (this.lastMove && (sq === this.lastMove[0] || sq === this.lastMove[1])) cls += ' last';
        if (sq === this.selected) cls += ' selected';
        if (this.targets.has(sq)) cls += this.targets.get(sq) ? ' target capture' : ' target';
        if (sq === this.checkSq) cls += ' check';
        if (this.hint && (sq === this.hint[0] || sq === this.hint[1])) cls += ' hint';
        el.className = cls;
      }
    }

    // -------------------------------------------------------------- dragging

    startDrag(event, sq) {
      const id = this.ids[sq];
      if (!id) return;
      const el = this.pieceEls.get(id);
      if (!el) return;

      const rect = this.root.getBoundingClientRect();
      const unitX = rect.width / 8;
      const unitY = rect.height / 8;
      const px = (event.clientX - rect.left) / unitX;
      const py = (event.clientY - rect.top) / unitY;

      this.drag = {
        sq,
        el,
        grabX: px - (this.visualX(sq) + 0.5),
        grabY: py - (this.visualY(sq) + 0.5)
      };
      el.classList.add('dragging');
      el.style.transition = 'none';
      this.root.classList.add('dragging');
    }

    updateDrag(event) {
      if (!this.drag) return;
      const rect = this.root.getBoundingClientRect();
      const unitX = rect.width / 8;
      const unitY = rect.height / 8;
      const x = (event.clientX - rect.left) / unitX - this.drag.grabX - 0.5;
      const y = (event.clientY - rect.top) / unitY - this.drag.grabY - 0.5;
      this.drag.el.style.setProperty('--x', String(x));
      this.drag.el.style.setProperty('--y', String(y));
    }

    endDrag(targetSq) {
      if (!this.drag) return;
      const { el, sq } = this.drag;
      el.classList.remove('dragging');
      el.style.transition = '';
      const finalSq = targetSq === undefined || targetSq === null ? sq : targetSq;
      el.style.setProperty('--x', String(this.visualX(finalSq)));
      el.style.setProperty('--y', String(this.visualY(finalSq)));
      this.root.classList.remove('dragging');
      this.drag = null;
    }

    bindPointer() {
      this.root.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const sq = this.squareFromPoint(e.clientX, e.clientY);
        if (sq < 0) return;
        e.preventDefault();
        try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        this.pointerId = e.pointerId;
        this.downSq = sq;
        this.downX = e.clientX;
        this.downY = e.clientY;
        this.moved = false;
        if (this.onDown) this.onDown(sq, e);
      });

      this.root.addEventListener('pointermove', (e) => {
        if (this.pointerId !== e.pointerId || this.downSq < 0) return;
        if (!this.moved) {
          const dx = e.clientX - this.downX;
          const dy = e.clientY - this.downY;
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.moved = true;
        }
        if (this.moved && this.drag) this.updateDrag(e);
      });

      const finish = (e) => {
        if (this.pointerId !== e.pointerId) return;
        const to = this.squareFromPoint(e.clientX, e.clientY);
        const from = this.downSq;
        const moved = this.moved;
        this.pointerId = null;
        this.downSq = -1;
        if (this.onUp) this.onUp(from, to, moved, e);
        if (this.drag) this.endDrag(null);
      };

      this.root.addEventListener('pointerup', finish);
      this.root.addEventListener('pointercancel', (e) => {
        if (this.pointerId !== e.pointerId) return;
        this.pointerId = null;
        this.downSq = -1;
        this.endDrag(null);
      });
    }
  }

  AC.BoardView = BoardView;
  AC.pieceSrc = pieceSrc;
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
