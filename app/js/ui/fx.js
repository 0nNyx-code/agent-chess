/* Agent Chess — Vitrine Glass cinematic layer.
 * Cosmetic only. Board coordinates come from BoardView so flipping stays
 * correct; no rules logic lives here.
 */
(function (AC) {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const PALETTE = {
    capture: ['#f2ede4', '#8aa2ff', '#c9d4ff', '#5f7ae0'],
    check: ['#e5484d', '#ff9c9c', '#f2ede4', '#8aa2ff'],
    mate: ['#f2ede4', '#8aa2ff', '#e5484d', '#ffffff'],
    promote: ['#f2ede4', '#8aa2ff', '#c9d4ff'],
    move: ['#8aa2ff', '#c9d4ff']
  };

  const classTemp = (el, cls, ms) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el['_t_' + cls]);
    el['_t_' + cls] = setTimeout(() => el.classList.remove(cls), ms);
  };

  class FX {
    constructor(boardEl, stageEl, quipEl, subtitleEl) {
      this.board = boardEl;
      this.stage = stageEl;
      this.quipEl = quipEl;
      this.subtitleEl = subtitleEl;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fx-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      boardEl.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.particles = [];
      this.rings = [];
      this.running = false;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = 0;
      this.h = 0;
      this.lastQuip = 0;

      this.resize();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(boardEl);
      } else {
        window.addEventListener('resize', () => this.resize());
      }
    }

    resize() {
      const rect = this.board.getBoundingClientRect();
      if (!rect.width) return;
      this.w = rect.width;
      this.h = rect.height;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    point(x, y) {
      return { x: (x + 0.5) / 8 * this.w, y: (y + 0.5) / 8 * this.h };
    }

    // ------------------------------------------------------------- emitters

    burst(vx, vy, kind, count) {
      const p = this.point(vx, vy);
      const colors = PALETTE[kind] || PALETTE.capture;
      const n = count || 26;
      for (let i = 0; i < n; i++) {
        const angle = rand(0, TAU);
        const speed = rand(40, 190) * (this.w / 380);
        this.particles.push({
          x: p.x + rand(-4, 4),
          y: p.y + rand(-4, 4),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - rand(18, 80),
          life: rand(0.5, 1.05),
          size: rand(1.4, 4),
          color: pick(colors),
          gravity: rand(110, 240),
          drag: 0.945
        });
      }
      this.rings.push({ x: p.x, y: p.y, r: 4, max: this.w * 0.13, life: 1, color: colors[1] });
      this.start();
    }

    shockwave(vx, vy, kind) {
      const p = this.point(vx, vy);
      this.rings.push({
        x: p.x, y: p.y, r: 2, max: this.w * 0.38, life: 1,
        color: (PALETTE[kind] || PALETTE.capture)[0], width: 3
      });
      this.start();
    }

    // ---------------------------------------------------------------- loop

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.update(dt);
        if (this.particles.length || this.rings.length) {
          requestAnimationFrame(tick);
        } else {
          this.running = false;
          this.ctx.clearRect(0, 0, this.w, this.h);
        }
      };
      requestAnimationFrame(tick);
    }

    update(dt) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, p.life * 2.2);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + Math.min(1, p.life * 2) * 0.7), 0, TAU);
        ctx.fill();
      }

      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt * 2.2;
        if (r.life <= 0) { this.rings.splice(i, 1); continue; }
        r.r += (r.max - r.r) * Math.min(1, dt * 8);
        ctx.globalAlpha = r.life * 0.5;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = (r.width || 2) * r.life;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // -------------------------------------------------------------- camera

    pov(from, to) {
      if (!this.stage) return;
      classTemp(this.stage, 'pov', 720);
      if (from && to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI + 135;
        this.stage.style.setProperty('--pov-angle', angle.toFixed(1) + 'deg');
      }
      clearTimeout(this.povTimer);
      this.povTimer = setTimeout(() => {
        if (this.stage) this.stage.style.removeProperty('--pov-angle');
      }, 760);
    }

    // ------------------------------------------------------------- screen

    shake(strength) {
      if (!this.stage) return;
      this.stage.style.setProperty('--shake', (strength || 6) + 'px');
      classTemp(this.stage, 'fx-shake', 340);
    }

    flash(kind) {
      if (!this.stage) return;
      classTemp(this.stage, kind === 'red' ? 'fx-flash-red' : 'fx-flash', 560);
    }

    impact() {
      if (!this.stage) return;
      classTemp(this.stage, 'fx-impact', 220);
      classTemp(this.stage, 'fx-speed', 460);
    }

    stamp(text, kind) {
      if (!this.stage) return;
      const el = document.createElement('div');
      el.className = 'fx-stamp' + (kind ? ' ' + kind : '');
      el.textContent = text;
      this.stage.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }

    quip(text, force) {
      if (!text || !this.quipEl) return;
      const now = performance.now();
      if (!force && now - this.lastQuip < 4800) return;
      this.lastQuip = now;
      this.quipEl.textContent = text;
      classTemp(this.quipEl, 'show', 3200);
    }

    subtitle(text, ms) {
      const el = this.subtitleEl;
      if (!el) return;
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(this.subTimer);
      this.subTimer = setTimeout(() => el.classList.remove('show'), ms || 2800);
    }

    // ----------------------------------------------------------- event glue

    onMove(kind, opts) {
      const o = opts || {};
      const from = (o.fx !== undefined && o.fy !== undefined) ? { x: o.fx, y: o.fy } : null;
      const to = (o.vx !== undefined && o.vy !== undefined) ? { x: o.vx, y: o.vy } : null;

      if (kind === 'capture') {
        this.pov(from, to);
        this.burst(o.vx, o.vy, 'capture', 34);
        this.shockwave(o.vx, o.vy, 'capture');
        this.shake(7);
        this.impact();
        this.flash('gold');
      } else if (kind === 'check') {
        this.pov(from, to);
        this.burst(o.vx, o.vy, 'check', 22);
        this.shake(5);
        this.impact();
        this.flash('red');
        this.stamp('CHECK', 'check');
      } else if (kind === 'mate') {
        this.pov(from, to);
        this.burst(o.vx, o.vy, 'mate', 64);
        this.shockwave(o.vx, o.vy, 'mate');
        this.shake(11);
        this.impact();
        this.flash('gold');
        this.stamp('CHECKMATE', 'mate');
      } else if (kind === 'promote') {
        this.pov(from, to);
        this.burst(o.vx, o.vy, 'promote', 26);
        this.shockwave(o.vx, o.vy, 'promote');
        this.flash('gold');
      } else {
        this.pov(from, to);
        this.burst(o.vx, o.vy, 'move', 8);
      }
    }

    onQuip(kind) {
      let line = null;
      if (kind === 'capture') {
        if (Math.random() < 0.7) line = pick([
          'I was using that.',
          'Bold. Rude, but bold.',
          'That is coming out of your paycheck.',
          'Okay. Noted.',
          'Rude.'
        ]);
      } else if (kind === 'check') {
        line = pick([
          'Your king looks nervous.',
          'Check. No pressure.',
          'This is fine.',
          'He is fine. Probably.'
        ]);
      } else if (kind === 'mate') {
        line = pick([
          'Good game. Mostly.',
          'And that is the game.',
          'Somebody call a medic.'
        ]);
      } else if (kind === 'promote') {
        line = pick([
          'A queen. How original.',
          'Congratulations, it is a queen.'
        ]);
      }
      if (line) {
        this.quip(line, kind !== 'capture');
        this.subtitle(line);
      }
    }
  }

  AC.FX = FX;
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
