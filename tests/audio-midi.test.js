import test from 'node:test';
import assert from 'node:assert/strict';
import midiPackage from '@tonejs/midi';
import { parseMidi } from '../src/midi.js';
import { PianoEngine, sampleForMidi } from '../src/audio.js';
const { Midi } = midiPackage;

function fixture() {
  const midi = new Midi();
  midi.name = 'Tempo and pedal';
  midi.header.tempos = [{ ticks: 0, bpm: 120 }, { ticks: 480, bpm: 60 }];
  midi.header.update();
  const right = midi.addTrack(); right.name = 'Right hand'; right.channel = 0;
  right.addNote({ midi: 64, ticks: 0, durationTicks: 480, velocity: 0.8 });
  right.addNote({ midi: 67, ticks: 480, durationTicks: 480, velocity: 0.7 });
  right.addCC({ number: 64, ticks: 240, value: 1 });
  right.addCC({ number: 64, ticks: 960, value: 0 });
  const left = midi.addTrack(); left.name = 'Left hand'; left.channel = 1;
  left.addNote({ midi: 48, ticks: 0, durationTicks: 960, velocity: 0.5 });
  const drums = midi.addTrack(); drums.channel = 9; drums.addNote({ midi: 36, time: 0, duration: 1, velocity: 1 });
  return midi;
}

test('tempo changes, physical note lengths, pedal holds and separate hands survive MIDI import', () => {
  const midi = fixture();
  const song = parseMidi(midi.toArray(), 'test.mid');
  assert.equal(song.title, 'Tempo and pedal');
  assert.equal(song.notes.length, 3);
  assert.equal(song.tracks.length, 2);
  const first = song.notes.find(note => note.midi === 64);
  const later = song.notes.find(note => note.midi === 67);
  assert.equal(first.duration, 0.5);
  assert.equal(first.sustainDuration, 1.5);
  assert.equal(later.time, 0.5);
  assert.equal(later.duration, 1);
  assert.equal(first.hand, 'right');
  assert.equal(song.notes.find(note => note.midi === 48).hand, 'left');
  assert.equal(song.duration, 2.3);
  assert.equal(song.contentDuration, 1.5);
});

test('pedal lookup follows note-off time even when long and short notes overlap', () => {
  const midi = new Midi(); const track = midi.addTrack();
  track.addNote({ midi: 60, time: 0, duration: 3, velocity: 1 });
  track.addNote({ midi: 64, time: 0.5, duration: 0.25, velocity: 1 });
  track.addCC({ number: 64, time: 0.6, value: 1 });
  track.addCC({ number: 64, time: 2, value: 0 });
  const song = parseMidi(midi.toArray(), 'overlap.mid');
  assert.equal(song.notes.find(note => note.midi === 64).sustainDuration, 1.5);
});

test('single-track music splits low and high keys and deduplicates imports by file bytes', () => {
  const midi = new Midi(); const track = midi.addTrack();
  track.addNote({ midi: 48, time: 0, duration: 1, velocity: 0.5 });
  track.addNote({ midi: 72, time: 0, duration: 1, velocity: 0.5 });
  const bytes = midi.toArray(); const first = parseMidi(bytes, 'Study.midi');
  assert.deepEqual(first.notes.map(note => note.hand), ['left', 'right']);
  assert.equal(first.title, 'Study');
  assert.equal(first.id, parseMidi(bytes, 'Different name.mid').id);
});

test('invalid, oversized and SMPTE files fail clearly', () => {
  assert.throws(() => parseMidi(new Uint8Array(20)), /not a MIDI/);
  assert.throws(() => parseMidi(new Uint8Array(10 * 1024 * 1024 + 1)), /smaller than/);
  const smpte = fixture().toArray(); smpte[12] = 0x80;
  assert.throws(() => parseMidi(smpte), /SMPTE/);
});

test('every standard piano key selects a sample within one semitone', () => {
  for (let midi = 21; midi <= 108; midi++) assert.ok(Math.abs(sampleForMidi(midi).root - midi) <= 1);
  assert.equal(sampleForMidi(21).name, 'A0');
  assert.equal(sampleForMidi(108).name, 'C8');
});

function fakeContext() {
  const events = [];
  const gainParam = () => ({ value: 0, setValueAtTime(...args) { events.push(['set', ...args]); }, linearRampToValueAtTime(...args) { events.push(['ramp', ...args]); }, exponentialRampToValueAtTime(...args) { events.push(['release', ...args]); }, cancelScheduledValues() {}, setTargetAtTime() {} });
  const context = { currentTime: 10, state: 'running', destination: {}, events,
    createGain: () => ({ gain: gainParam(), connect() {}, disconnect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }),
    createBufferSource: () => ({ playbackRate: {}, connect() {}, disconnect() {}, start(...args) { events.push(['start', ...args]); }, stop(...args) { events.push(['stop', ...args]); } }),
    decodeAudioData: async () => ({ duration: 20 }), close() {},
  };
  return context;
}

test('audio clock preserves pitch at half speed, includes a held seek note, and stops on pause', async () => {
  const context = fakeContext();
  const engine = new PianoEngine({ contextFactory: () => context, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }), baseUrl: '/samples/' });
  const song = { id: 'test', duration: 5, notes: [{ time: 0, duration: 2, sustainDuration: 3, midi: 61, velocity: 0.7 }] };
  await engine.play(song, 1, 0.5);
  const start = context.events.find(event => event[0] === 'start');
  assert.ok(Math.abs(start[1] - 10.035) < 1e-9);
  assert.ok(Math.abs(start[2] - (2 * sampleForMidi(61).rate)) < 1e-9);
  context.currentTime = 12.035;
  assert.ok(Math.abs(engine.currentTime - 2) < 1e-9);
  const stopCount = context.events.filter(event => event[0] === 'stop').length;
  assert.ok(Math.abs(engine.pause() - 2) < 1e-9);
  assert.equal(engine.playing, false);
  assert.ok(context.events.filter(event => event[0] === 'stop').length > stopCount);
  engine.destroy();
});

test('delayed scheduler skips already finished notes instead of bursting stale notes', async () => {
  const context = fakeContext();
  const engine = new PianoEngine({ contextFactory: () => context, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }), baseUrl: '/samples/' });
  const song = { id: 'late', duration: 10, notes: [{ time: 1, duration: 0.2, midi: 60, velocity: 1 }] };
  await engine.play(song);
  context.currentTime = 14;
  engine.tick();
  assert.equal(context.events.filter(event => event[0] === 'start').length, 0);
  engine.destroy();
});

test('CC64 in a controller-only track retains its actual MIDI channel', () => {
  const midi = new Midi();
  const notes = midi.addTrack(); notes.channel = 3;
  notes.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 1 });
  const pedal = midi.addTrack(); pedal.channel = 3;
  pedal.addCC({ number: 64, time: 0.25, value: 1 });
  pedal.addCC({ number: 64, time: 1.5, value: 0 });
  const song = parseMidi(midi.toArray(), 'controller.mid');
  assert.equal(song.notes[0].duration, 0.5);
  assert.equal(song.notes[0].sustainDuration, 1.5);
  assert.equal(song.pedals[0].channel, 3);
});
