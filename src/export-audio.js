import { sampleForMidi } from './audio.js';

export const EXPORT_AUDIO_RATE = 48000;
export const EXPORT_AUDIO_CHUNK_SECONDS = 8;
const RELEASE_SECONDS = 0.35;
// Reconstruct enough history to settle the live piano compressor before each cut.
const PREROLL_SECONDS = 1.5;
const ATTACK_SECONDS = 0.002;

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function timing({ speed = 1, lead = 2, tail = 0.8 } = {}) {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 2) throw new Error('Choose a playback speed between 0.25× and 2×.');
  if (!Number.isFinite(lead) || lead < 0 || !Number.isFinite(tail) || tail < 0) throw new Error('Invalid export timing.');
  return { speed, lead, tail };
}

/** The whole export timeline, including the silent visual lead-in and final decay. */
export function getExportDuration(song, options = {}) {
  const { speed, lead, tail } = timing(options);
  if (!Number.isFinite(song?.duration) || song.duration <= 0) throw new Error('Choose a song to export.');
  return Math.ceil((lead + song.duration / speed + tail) * EXPORT_AUDIO_RATE) / EXPORT_AUDIO_RATE;
}

/** Pure scheduling plan; physical note lengths are kept for visuals elsewhere. */
export function planAudioNotes(song, { buffers, speed = 1, lead = 2 } = {}) {
  timing({ speed, lead });
  return song.notes.map(note => {
    const { root, rate } = sampleForMidi(note.midi);
    const buffer = buffers?.get(root);
    if (!buffer) throw new Error('The piano is still loading. Try exporting again.');
    const time = lead + note.time / speed;
    const holdEnd = time + (note.sustainDuration ?? note.duration) / speed;
    const releaseEnd = holdEnd + RELEASE_SECONDS;
    return {
      time, holdEnd, releaseEnd,
      end: Math.min(releaseEnd, time + buffer.duration / rate),
      buffer, rate,
      level: 1.25 * Math.min(1, Math.max(0.01, note.velocity)) ** 1.6,
    };
  }).sort((a, b) => a.time - b.time);
}

function envelopeAt(note, at) {
  const elapsed = at - note.time;
  if (elapsed <= 0) return 0;
  if (elapsed < ATTACK_SECONDS) return note.level * elapsed / ATTACK_SECONDS;
  if (at <= note.holdEnd) return note.level;
  const progress = Math.min(1, (at - note.holdEnd) / RELEASE_SECONDS);
  // Match the live piano's exponential release from note.level to 0.0001.
  return note.level * (0.0001 / note.level) ** progress;
}

function schedule(context, master, note, renderStart, renderEnd) {
  const audibleStart = Math.max(note.time, renderStart);
  if (audibleStart >= note.end || audibleStart >= renderEnd) return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = note.buffer;
  source.playbackRate.value = note.rate;
  const start = audibleStart - renderStart;
  const attackEnd = note.time + ATTACK_SECONDS;
  gain.gain.setValueAtTime(envelopeAt(note, audibleStart), start);
  if (audibleStart < attackEnd) gain.gain.linearRampToValueAtTime(note.level, attackEnd - renderStart);
  if (audibleStart < note.holdEnd) gain.gain.setValueAtTime(note.level, note.holdEnd - renderStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, note.releaseEnd - renderStart);
  source.connect(gain);
  gain.connect(master);
  // The source recording advances at its natural pitch rate, independent of tempo.
  source.start(start, Math.max(0, audibleStart - note.time) * note.rate);
  source.stop(Math.min(renderEnd, note.end) - renderStart);
}

/**
 * Render the same Salamander performance as playback without recording in real time.
 * Each yielded stereo AudioBuffer immediately follows the previous one. Memory stays
 * bounded to one eight-second chunk, its compressor preroll, and the decoded samples.
 */
export async function* renderAudioChunks(song, {
  buffers, speed = 1, volume = 0.72, lead = 2, tail = 0.8,
  signal, onProgress = () => {},
  contextFactory = options => {
    const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!Context) throw new Error('Offline audio export is unavailable in this browser.');
    return new Context(options);
  },
} = {}) {
  const duration = getExportDuration(song, { speed, lead, tail });
  const frames = Math.round(duration * EXPORT_AUDIO_RATE);
  const chunkFrames = EXPORT_AUDIO_CHUNK_SECONDS * EXPORT_AUDIO_RATE;
  const notes = planAudioNotes(song, { buffers, speed, lead });
  const gainValue = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.72));
  let next = 0, active = [];
  onProgress(0);
  for (let firstFrame = 0; firstFrame < frames; firstFrame += chunkFrames) {
    checkAbort(signal);
    // Give cancellation, progress painting and other controls a turn between chunks.
    await new Promise(resolve => setTimeout(resolve, 0));
    checkAbort(signal);
    const count = Math.min(chunkFrames, frames - firstFrame);
    const start = firstFrame / EXPORT_AUDIO_RATE;
    const end = (firstFrame + count) / EXPORT_AUDIO_RATE;
    const historyFrames = Math.min(firstFrame, Math.round(PREROLL_SECONDS * EXPORT_AUDIO_RATE));
    const renderStart = (firstFrame - historyFrames) / EXPORT_AUDIO_RATE;
    const context = contextFactory({ numberOfChannels: 2, length: count + historyFrames, sampleRate: EXPORT_AUDIO_RATE });
    const master = context.createGain();
    master.gain.value = gainValue;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.connect(limiter);
    limiter.connect(context.destination);
    while (next < notes.length && notes[next].time < end) active.push(notes[next++]);
    active = active.filter(note => note.end > renderStart);
    for (const note of active) schedule(context, master, note, renderStart, end);
    const rendered = await context.startRendering();
    checkAbort(signal);
    let buffer = rendered;
    if (historyFrames) {
      buffer = context.createBuffer(2, count, EXPORT_AUDIO_RATE);
      for (let channel = 0; channel < 2; channel++) buffer.copyToChannel(rendered.getChannelData(channel).subarray(historyFrames, historyFrames + count), channel);
    }
    onProgress((firstFrame + count) / frames);
    yield { buffer, timestamp: start };
  }
}
