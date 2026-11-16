import test from 'node:test';
import assert from 'node:assert/strict';
import { getExportDuration, planAudioNotes, renderAudioChunks, EXPORT_AUDIO_RATE } from '../src/export-audio.js';
import { sampleForMidi } from '../src/audio.js';

const note = { time: 1, duration: 1, sustainDuration: 5, midi: 61, velocity: 0.8 };
const song = { duration: 18.1, notes: [note] };
const buffers = new Map([[sampleForMidi(note.midi).root, { duration: 30 }]]);
function fakeBuffer(channels, length, sampleRate) {
  const planes = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: c => planes[c], copyToChannel: (data, c) => planes[c].set(data) };
}
function factory(contexts) {
  return options => {
    const calls = [], sources = [], gains = [];
    const param = () => ({ value: 0, setValueAtTime(...args) { calls.push(['set', ...args]); }, linearRampToValueAtTime(...args) { calls.push(['ramp', ...args]); }, exponentialRampToValueAtTime(...args) { calls.push(['release', ...args]); } });
    const context = { options, calls, sources, gains, destination: {},
      createGain() { const gain = { gain: param(), connect() {} }; gains.push(gain); return gain; },
      createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }),
      createBufferSource() { const source = { playbackRate: {}, connect() {}, start(...args) { source.startArgs = args; }, stop(...args) { source.stopArgs = args; } }; sources.push(source); return source; },
      createBuffer: fakeBuffer,
      async startRendering() { return fakeBuffer(options.numberOfChannels, options.length, options.sampleRate); },
    };
    contexts.push(context); return context;
  };
}

test('export duration follows speed and includes the lead and decay without sample rounding gaps', () => {
  assert.equal(getExportDuration(song, { speed: 0.5, lead: 2, tail: 0.8 }), 39);
  assert.throws(() => getExportDuration(song, { speed: 0 }), /speed/);
});

test('offline note plan follows pedal hold, velocity and natural sample pitch', () => {
  const plan = planAudioNotes(song, { buffers, speed: 0.5, lead: 2 });
  assert.equal(plan[0].time, 4);
  assert.equal(plan[0].holdEnd, 14);
  assert.equal(plan[0].rate, sampleForMidi(61).rate);
  assert.equal(plan[0].level, 1.25 * 0.8 ** 1.6);
  assert.throws(() => planAudioNotes(song, { buffers: new Map() }), /still loading/);
});

test('chunk audio stays contiguous and stereo, and reconstructs a sustain crossing a chunk boundary', async () => {
  const contexts = [], chunks = [];
  for await (const chunk of renderAudioChunks(song, { buffers, speed: 0.5, lead: 2, tail: 0.8, contextFactory: factory(contexts) })) chunks.push(chunk);
  assert.equal(chunks.length, 5);
  assert.deepEqual(chunks.map(chunk => chunk.timestamp), [0, 8, 16, 24, 32]);
  assert.equal(chunks.reduce((frames, chunk) => frames + chunk.buffer.length, 0), 39 * EXPORT_AUDIO_RATE);
  assert.ok(chunks.every(chunk => chunk.buffer.numberOfChannels === 2 && chunk.buffer.duration <= 8));
  assert.equal(contexts[0].sources[0].startArgs[0], 4);
  // The second chunk renders from6.5s (1.5s compressor history): the original
  // note started at4s, so its sample offset must advance2.5seconds * pitch rate.
  assert.ok(Math.abs(contexts[1].sources[0].startArgs[1] - 2.5 * sampleForMidi(61).rate) < 1e-9);
  assert.equal(contexts[1].gains[0].gain.value, 0.72);
  assert.equal(chunks[1].buffer.length, 8 * EXPORT_AUDIO_RATE);
});

test('a release crossing a chunk boundary resumes at its existing envelope level instead of reattacking', async () => {
  const contexts = [], releaseSong = { duration: 9, notes: [{ ...note, time: 5, duration: 0.9, sustainDuration: 0.9 }] };
  for await (const _ of renderAudioChunks(releaseSong, { buffers, lead: 2, contextFactory: factory(contexts) })) { /* render both chunks */ }
  // Context2 history begins6.5s, before this note starts7s: there is one original
  // attack in preroll, not a fresh attack at the actual8s output boundary.
  const source = contexts[1].sources[0];
  assert.equal(source.startArgs[0], 0.5);
  assert.equal(source.startArgs[1], 0);
  assert.ok(contexts[1].calls.some(call => call[0] === 'release' && Math.abs(call[2] - 1.75) < 1e-9));
});

test('export cancellation stops rendering further chunks', async () => {
  const controller = new AbortController(), contexts = [];
  const generator = renderAudioChunks(song, { buffers, signal: controller.signal, contextFactory: factory(contexts) });
  const first = await generator.next();
  assert.equal(first.value.timestamp, 0);
  controller.abort();
  await assert.rejects(generator.next(), { name: 'AbortError' });
  assert.equal(contexts.length, 1);
});
