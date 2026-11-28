/* Agent Chess — tiny synthesised sound engine (no audio files). */
(function (AC) {
  'use strict';

  let ctx = null;
  let noiseBuffer = null;
  let enabled = true;
  let master = null;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function getNoise() {
    if (noiseBuffer || !ctx) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.35);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function tone(freq, dur, type, gain, delay, endFreq) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, gain, freq, q, delay, type) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const src = c.createBufferSource();
    src.buffer = getNoise();
    const filter = c.createBiquadFilter();
    filter.type = type || 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const Sound = {
    unlock() {
      ensure();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled && ctx) {
        master.gain.value = 0;
      } else if (ctx) {
        master.gain.value = 0.5;
      }
    },
    isEnabled() {
      return enabled;
    },
    move() {
      if (!enabled) return;
      noise(0.045, 0.22, 1500, 1.1);
      tone(190, 0.075, 'sine', 0.14, 0, 120);
    },
    capture() {
      if (!enabled) return;
      noise(0.09, 0.3, 700, 0.8, 0, 'lowpass');
      tone(105, 0.14, 'sine', 0.2, 0, 60);
      tone(240, 0.05, 'triangle', 0.08);
    },
    check() {
      if (!enabled) return;
      tone(880, 0.09, 'triangle', 0.11);
      tone(1174, 0.14, 'triangle', 0.1, 0.085);
    },
    end(win) {
      if (!enabled) return;
      if (win) {
        tone(523, 0.12, 'triangle', 0.1);
        tone(659, 0.12, 'triangle', 0.1, 0.1);
        tone(784, 0.22, 'triangle', 0.11, 0.2);
      } else {
        tone(392, 0.16, 'sine', 0.11);
        tone(311, 0.22, 'sine', 0.1, 0.14);
        tone(233, 0.3, 'sine', 0.1, 0.3);
      }
    },
    click() {
      if (!enabled) return;
      tone(1250, 0.03, 'triangle', 0.05);
    },
    error() {
      if (!enabled) return;
      tone(160, 0.12, 'square', 0.05, 0, 110);
    }
  };

  AC.Sound = Sound;
})(typeof window !== 'undefined' ? (window.AC = window.AC || {}) : (globalThis.AC = globalThis.AC || {}));
