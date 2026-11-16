/** A deterministic piano roll. Audio and animation share the transport's song time. */
const BLACK = new Set([1, 3, 6, 8, 10]);
const DEFAULTS = {
  rightColor: '#edc18a',
  leftColor: '#8dbedb',
  background: 'midnight',
  glow: 0.65,
  fallSpeed: 4.5,
  labels: false,
  range: 'fit',
  shimmer: true,
};
const PALETTES = {
  midnight: { top: '#101318', bottom: '#181d25', white: '#f2f0e9', whiteBottom: '#c8cac9', black: '#292e35', blackBottom: '#070a0e', line: [211, 223, 240], keyLine: '#7e858a', text: '#717a85' },
  ivory: { top: '#f2f0eb', bottom: '#e5e7e7', white: '#fffefb', whiteBottom: '#d8dbdb', black: '#30383f', blackBottom: '#11181d', line: [66, 79, 93], keyLine: '#aab1b6', text: '#6d7880' },
  dusk: { top: '#211d2c', bottom: '#242a3d', white: '#f3edf0', whiteBottom: '#c8c6d1', black: '#363341', blackBottom: '#110f1a', line: [223, 209, 236], keyLine: '#8b8497', text: '#827c91' },
};
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
function rgb(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex || '')) return [141, 190, 219];
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
const blend = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function lowerBound(values, value) {
  let a = 0, b = values.length;
  while (a < b) { const m = (a + b) >>> 1; if (values[m] < value) a = m + 1; else b = m; }
  return a;
}
function upperBound(values, value) {
  let a = 0, b = values.length;
  while (a < b) { const m = (a + b) >>> 1; if (values[m] <= value) a = m + 1; else b = m; }
  return a;
}
function rounded(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

export class PianoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.options = { ...DEFAULTS };
    this.notes = [];
    this.starts = [];
    this.time = 0;
    this.maxHold = 0;
    this.keys = new Map();
    this.reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  setSong(song) {
    this.song = song;
    this.notes = (song?.notes || []).filter(n => Number.isFinite(n.time) && Number.isFinite(n.duration) && Number.isFinite(n.midi)).slice().sort((a, b) => a.time - b.time);
    this.starts = this.notes.map(n => n.time);
    this.maxHold = this.notes.reduce((m, n) => Math.max(m, n.duration), 0);
    this.layout();
    this.draw(0);
  }

  setOptions(options = {}) {
    const oldRange = this.options.range;
    this.options = { ...this.options, ...options };
    this.options.glow = clamp(Number(this.options.glow) || 0, 0, 1);
    this.options.fallSpeed = clamp(Number(this.options.fallSpeed) || 4.5, 2, 8);
    if (oldRange !== this.options.range) this.layout();
    this.draw(this.time);
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(this.width * this.dpr), h = Math.round(this.height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
    this.draw(this.time);
  }

  layout() {
    if (!this.width || !this.height) return;
    let lo = 21, hi = 108;
    if (this.options.range === 'fit' && this.notes.length) {
      const pitches = this.notes.map(n => n.midi);
      let min = 108, max = 21;
      for (const p of pitches) { min = Math.min(min, p); max = Math.max(max, p); }
      // Whole octaves give a stable, familiar keyboard with room around the music.
      lo = clamp(Math.floor((min - 2) / 12) * 12, 21, 96);
      hi = clamp(Math.ceil((max + 3) / 12) * 12 - 1, 32, 108);
      if (hi - lo < 35) {
        const extra = Math.ceil((35 - hi + lo) / 2);
        lo = Math.max(21, lo - extra); hi = Math.min(108, hi + extra);
      }
    }
    while (BLACK.has(lo % 12) && lo > 21) lo--;
    while (BLACK.has(hi % 12) && hi < 108) hi++;
    this.minPitch = lo;
    this.maxPitch = hi;
    const whites = [];
    for (let p = lo; p <= hi; p++) if (!BLACK.has(p % 12)) whites.push(p);
    this.padding = clamp(this.width * 0.028, 12, 44);
    this.keyWidth = (this.width - this.padding * 2) / whites.length;
    this.keyHeight = clamp(this.height * 0.185, 90, 172);
    this.bottom = this.height - clamp(this.height * 0.032, 14, 28);
    this.strike = this.bottom - this.keyHeight;
    this.keys.clear();
    let whiteIndex = 0;
    for (let p = lo; p <= hi; p++) {
      const black = BLACK.has(p % 12);
      const width = this.keyWidth * (black ? 0.59 : 1);
      const x = this.padding + (whiteIndex - (black ? 0.295 : 0)) * this.keyWidth;
      this.keys.set(p, { x, width, black });
      if (!black) whiteIndex++;
    }
  }

  draw(time = 0) {
    if (!this.ctx || !this.width || !this.height) return;
    this.time = Number.isFinite(time) ? Math.max(0, time) : 0;
    const ctx = this.ctx, w = this.width, h = this.height;
    const palette = PALETTES[this.options.background] || PALETTES.midnight;
    const light = this.options.background === 'ivory';
    const right = rgb(this.options.rightColor), left = rgb(this.options.leftColor);
    const colors = { right, left };
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, palette.top); bg.addColorStop(1, palette.bottom);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // A quiet pool of light connects the glass controls and the instrument.
    const halo = ctx.createRadialGradient(w * .5, h * .55, 0, w * .5, h * .55, w * .65);
    halo.addColorStop(0, rgba(blend(right, left, .6), light ? .035 : .055));
    halo.addColorStop(1, rgba(left, 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    const lookAhead = this.options.fallSpeed;
    const pps = Math.max(1, this.strike - 30) / lookAhead;
    const t = this.time;
    const start = lowerBound(this.starts, t - Math.max(this.maxHold, .7) - .05);
    const end = upperBound(this.starts, t + lookAhead + .2);
    const active = new Map();
    const recent = [];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, this.strike); ctx.clip();
    // Faint octave guides add structure without a grid of distracting lines.
    ctx.strokeStyle = rgba(palette.line, light ? .045 : .038); ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [p, key] of this.keys) if (p % 12 === 0) {
      const x = Math.round(key.x) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, this.strike);
    }
    ctx.stroke();
    for (let i = start; i < end; i++) {
      const n = this.notes[i], key = this.keys.get(n.midi);
      if (!key) continue;
      const release = n.time + n.duration;
      const hand = n.hand === 'left' || n.hand === 1 ? 'left' : 'right';
      const color = colors[hand];
      const velocity = clamp(n.velocity > 1 ? n.velocity / 127 : (n.velocity ?? .7), .05, 1);
      const isActive = n.time <= t && release > t;
      if (isActive) {
        const existing = active.get(n.midi);
        if (!existing || existing.velocity < velocity) active.set(n.midi, { color, velocity, age: t - n.time });
      }
      if (t >= n.time && t - n.time < .7) recent.push({ ...n, key, color, velocity });
      if (release < t || n.time > t + lookAhead) continue;
      const inset = Math.min(key.width * .12, 4);
      const x = key.x + inset, width = Math.max(1, key.width - inset * 2);
      const bottom = Math.min(this.strike, this.strike - (n.time - t) * pps);
      const top = this.strike - (release - t) * pps;
      if (bottom <= 0 || top >= this.strike) continue;
      const noteHeight = Math.max(1.5, bottom - top);
      if (isActive && this.options.glow > 0) {
        ctx.shadowColor = rgba(color, .55 * this.options.glow);
        ctx.shadowBlur = 12 * this.options.glow;
      }
      const fill = ctx.createLinearGradient(x, 0, x + width, 0);
      fill.addColorStop(0, rgba(blend(color, [255, 255, 255], light ? .05 : .1), .72 + velocity * .25));
      fill.addColorStop(.6, rgba(color, .72 + velocity * .25));
      fill.addColorStop(1, rgba(blend(color, [255, 255, 255], .1), .72 + velocity * .25));
      ctx.fillStyle = fill;
      rounded(ctx, x, top, width, noteHeight, Math.min(5, width * .18));
      ctx.shadowBlur = 0;
      if (width > 7 && noteHeight > 9) {
        ctx.fillStyle = rgba([255, 255, 255], light ? .2 : .25);
        rounded(ctx, x + Math.min(2, width * .13), top + 1.5, Math.max(1, width - Math.min(4, width * .26)), 1, .5);
      }
    }
    ctx.restore();
    this.drawKeyboard(ctx, palette, active);
    this.drawShimmer(ctx, recent, light);
  }

  drawKeyboard(ctx, palette, active) {
    const { padding, width, strike, bottom, keyHeight } = this;
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    rounded(ctx, padding - 1, strike - 2, width - padding * 2 + 2, keyHeight + 5, 4);
    // Whites first. Black keys are raised above them so a pressed white never covers a black.
    for (const [p, key] of this.keys) {
      if (key.black) continue;
      const a = active.get(p), x = key.x + .45, kw = Math.max(.5, key.width - .9);
      const gradient = ctx.createLinearGradient(0, strike, 0, bottom);
      if (a) {
        gradient.addColorStop(0, rgba(blend(a.color, [255, 255, 255], .17), 1));
        gradient.addColorStop(.19, rgba(blend(a.color, [255, 255, 255], .08), 1));
        gradient.addColorStop(1, rgba(blend(a.color, rgb(palette.whiteBottom), .55), 1));
      } else {
        gradient.addColorStop(0, palette.white); gradient.addColorStop(.7, palette.white); gradient.addColorStop(1, palette.whiteBottom);
      }
      ctx.fillStyle = gradient; rounded(ctx, x, strike, kw, keyHeight, Math.min(2, kw * .1));
      ctx.fillStyle = a ? rgba([255, 255, 255], .45) : 'rgba(255,255,255,.5)';
      ctx.fillRect(x + .5, strike + 1, Math.max(0, kw - 1), 1);
      ctx.fillStyle = 'rgba(44,52,57,.16)'; ctx.fillRect(x, bottom - 3, kw, 1);
      if (this.options.labels && p % 12 === 0 && key.width >= 12) {
        ctx.font = `400 ${Math.min(10, key.width * .36)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = palette.text;
        ctx.fillText(`C${Math.floor(p / 12) - 1}`, key.x + key.width / 2, bottom - 10);
      }
    }
    for (const [p, key] of this.keys) {
      if (!key.black) continue;
      const a = active.get(p), kh = keyHeight * .63;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      rounded(ctx, key.x - .6, strike + 1.5, key.width + 1.2, kh + 1.5, 1.5);
      const gradient = ctx.createLinearGradient(0, strike, 0, strike + kh);
      gradient.addColorStop(0, a ? rgba(blend(a.color, [255, 255, 255], .04), 1) : palette.black);
      gradient.addColorStop(1, a ? rgba(blend(a.color, [8, 12, 19], .35), 1) : palette.blackBottom);
      ctx.fillStyle = gradient; rounded(ctx, key.x, strike, key.width, kh, 1.5);
      ctx.fillStyle = a ? rgba([255, 255, 255], .34) : 'rgba(255,255,255,.1)';
      ctx.fillRect(key.x + 1, strike + 1, Math.max(0, key.width - 2), 1);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(key.x + 1, strike + kh - 4, Math.max(0, key.width - 2), 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fillRect(padding, strike - 1, width - padding * 2, 1);
    if (this.options.glow > 0) for (const [p, a] of active) {
      const key = this.keys.get(p), x = key.x + key.width / 2;
      const radius = Math.max(9, key.width * 1.4);
      const glow = ctx.createRadialGradient(x, strike, 0, x, strike, radius);
      glow.addColorStop(0, rgba(a.color, .22 * this.options.glow)); glow.addColorStop(1, rgba(a.color, 0));
      ctx.fillStyle = glow; ctx.fillRect(x - radius, strike - radius, radius * 2, radius * 2);
    }
  }

  drawShimmer(ctx, recent, light) {
    const intensity = this.options.glow;
    if (!this.options.shimmer || intensity <= 0 || this.reducedMotion) return;
    ctx.save(); ctx.globalCompositeOperation = light ? 'source-over' : 'screen';
    for (const n of recent) {
      const age = this.time - n.time, fade = Math.pow(1 - age / .7, 1.7);
      if (fade <= 0) continue;
      const x = n.key.x + n.key.width / 2, y = this.strike - 2;
      const r = Math.max(12, n.key.width * 1.1) * (1 + age * 1.3);
      const aura = ctx.createRadialGradient(x, y, 0, x, y, r);
      aura.addColorStop(0, rgba(blend(n.color, [255, 255, 255], .3), .4 * fade * intensity));
      aura.addColorStop(1, rgba(n.color, 0));
      ctx.fillStyle = aura; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      for (let j = 0; j < 8; j++) {
        const seed = (n.midi * 83 + j * 197 + Math.round(n.time * 1000)) % 997;
        const unit = ((seed * 37) % 997) / 997;
        const angle = Math.PI * (.18 + .64 * unit);
        const speed = 25 + ((seed * 71) % 997) / 997 * 55;
        const px = x + Math.cos(angle) * speed * age;
        const py = y - Math.sin(angle) * speed * age + age * age * 16;
        const size = .5 + ((seed * 13) % 997) / 997;
        const sparkle = Math.pow(Math.sin(age * (8 + j) + j), 2);
        ctx.fillStyle = rgba(blend(n.color, [255, 255, 255], .65), fade * intensity * (.3 + .7 * sparkle));
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.notes = [];
    this.starts = [];
    this.keys.clear();
    this.canvas = null;
    this.ctx = null;
  }
}
