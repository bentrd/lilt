const SAMPLE_ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
const SAMPLE_NAMES = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
const RELEASE_SECONDS = 0.35;
const SCHEDULE_AHEAD = 0.2;

export function sampleForMidi(midi) {
  const root = SAMPLE_ROOTS.reduce((best, value) => Math.abs(value - midi) < Math.abs(best - midi) ? value : best, SAMPLE_ROOTS[0]);
  return { root, name: `${SAMPLE_NAMES[root % 12]}${Math.floor(root / 12) - 1}`, rate: 2 ** ((midi - root) / 12) };
}

export class PianoEngine {
  constructor(options = {}) {
    this.context = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.voices = new Set();
    this.volume = 0.75;
    this.position = 0;
    this.speed = 1;
    this.song = null;
    this.playing = false;
    this.ready = false;
    this.onended = null;
    this.baseUrl = options.baseUrl ?? `${import.meta.env?.BASE_URL || '/'}samples/`;
    this.contextFactory = options.contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
    this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this.timer = null;
    this.preparedId = null;
    this.playGeneration = 0;
  }

  get currentTime() {
    if (!this.playing || !this.context) return this.position;
    return Math.min(this.song.duration, Math.max(this.position, this.position + (this.context.currentTime - this.anchor) * this.speed));
  }

  async ensureContext() {
    if (!this.context) {
      this.context = this.contextFactory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      // The limiter catches dense imported chords without flattening normal piano dynamics.
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter);
      this.limiter.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async loadRoot(root) {
    if (this.buffers.has(root)) return this.buffers.get(root);
    if (this.loading.has(root)) return this.loading.get(root);
    const task = (async () => {
      const name = sampleForMidi(root).name;
      let lastError;
      for (const extension of ['ogg', 'mp3']) {
        try {
          const response = await this.fetch(`${this.baseUrl}${name}.${extension}`);
          if (!response.ok) throw new Error(`Sample request failed (${response.status})`);
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(root, buffer);
          return buffer;
        } catch (error) { lastError = error; }
      }
      throw new Error(`The piano could not load. Check your connection and try again.`, { cause: lastError });
    })();
    this.loading.set(root, task);
    try { return await task; } finally { this.loading.delete(root); }
  }

  async prepare(song, onProgress = () => {}) {
    await this.ensureContext();
    const roots = [...new Set(song.notes.map(note => sampleForMidi(note.midi).root))];
    let finished = 0;
    onProgress(0);
    // Bound simultaneous requests and decoding on phones.
    const remaining = [...roots];
    await Promise.all(Array.from({ length: Math.min(4, roots.length) }, async () => {
      while (remaining.length) {
        await this.loadRoot(remaining.shift());
        onProgress(++finished / roots.length);
      }
    }));
    this.preparedId = song.id;
    this.ready = true;
  }

  async play(song, from = 0, speed = 1) {
    const generation = ++this.playGeneration;
    this.pause(false);
    if (this.preparedId !== song.id) await this.prepare(song);
    else await this.ensureContext();
    if (generation !== this.playGeneration) return;
    this.song = song;
    this.position = Math.max(0, Math.min(from, song.duration));
    this.speed = Math.max(0.25, Math.min(2, speed));
    this.anchor = this.context.currentTime + 0.035;
    this.playing = true;
    // Include physically held and pedal-sustained notes when seeking inside them.
    this.nextIndex = 0;
    while (this.nextIndex < song.notes.length && song.notes[this.nextIndex].time < this.position) {
      const note = song.notes[this.nextIndex++];
      if (note.time + (note.sustainDuration ?? note.duration) > this.position) this.schedule(note, this.position);
    }
    this.tick();
    if (this.playing) this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    if (!this.playing) return;
    const now = this.currentTime;
    const until = now + SCHEDULE_AHEAD * this.speed;
    while (this.nextIndex < this.song.notes.length && this.song.notes[this.nextIndex].time <= until) this.schedule(this.song.notes[this.nextIndex++]);
    if (now >= this.song.duration) {
      this.pause(false);
      this.position = this.song.duration;
      this.onended?.();
    }
  }

  schedule(note, seekPosition = null) {
    const { root, rate } = sampleForMidi(note.midi);
    const buffer = this.buffers.get(root);
    if (!buffer) return;
    const duration = note.sustainDuration ?? note.duration;
    let elapsed = seekPosition === null ? 0 : Math.max(0, seekPosition - note.time);
    const target = this.anchor + (note.time + elapsed - this.position) / this.speed;
    const late = Math.max(0, this.context.currentTime - target);
    elapsed += late * this.speed;
    const offset = elapsed / this.speed * rate;
    if (offset >= buffer.duration || elapsed >= duration) return;
    const when = Math.max(this.context.currentTime, target);
    const hold = (duration - elapsed) / this.speed;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const velocity = Math.min(1, Math.max(0.01, note.velocity));
    const level = 1.25 * velocity ** 1.6;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.002);
    gain.gain.setValueAtTime(level, when + Math.max(0.003, hold));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold + RELEASE_SECONDS);
    source.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(when, offset);
    source.stop(when + hold + RELEASE_SECONDS + 0.01);
  }

  pause(cancelPendingPlay = true) {
    if (cancelPendingPlay) ++this.playGeneration;
    if (this.playing) this.position = this.currentTime;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.context) {
      const now = this.context.currentTime;
      for (const { source, gain } of this.voices) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.008);
        try { source.stop(now + 0.04); } catch { /* A voice may already have naturally ended. */ }
      }
    }
    return this.position;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    this.master?.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
  }

  destroy() {
    this.pause();
    this.context?.close();
    this.buffers.clear();
    this.ready = false;
  }
}
