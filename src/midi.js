import * as midiPackage from '@tonejs/midi';
import * as midiFile from 'midi-file';

const Midi = midiPackage.Midi || midiPackage.default?.Midi;
const readMidiFile = midiFile.parseMidi || midiFile.default?.parseMidi;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const rounded = number => Math.round(number * 1000000) / 1000000;

function stableId(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `midi-${(hash >>> 0).toString(16)}-${bytes.length}`;
}

function median(notes) {
  const values = notes.map(note => note.midi).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function namedHand(name) {
  if (/\b(left|lh|bass|basse|mano sinistra)\b/i.test(name)) return 'left';
  if (/\b(right|rh|treble|dessus|mano destra)\b/i.test(name)) return 'right';
  return null;
}

function pedalIntervals(events, end) {
  const intervals = [];
  let down = null;
  for (const event of events.sort((a, b) => a.time - b.time)) {
    if (event.value >= 0.5 && down === null) down = event.time;
    if (event.value < 0.5 && down !== null) {
      intervals.push([down, event.time]);
      down = null;
    }
  }
  if (down !== null) intervals.push([down, end]);
  return intervals;
}

/** Parse a MIDI locally. Note durations remain physical; sustainDuration follows CC64. */
export function parseMidi(input, filename = 'Untitled.mid') {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Choose a MIDI smaller than 10 MB.');
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') throw new Error('This file is not a MIDI.');
  // SMPTE tick timing is not supported by the score parser; do not silently mis-time it.
  if (bytes[12] & 0x80) throw new Error('This MIDI uses SMPTE timing. Export it with musical beat timing.');
  let midi;
  try { midi = new Midi(bytes); } catch { throw new Error('This MIDI could not be read. Try exporting it again.'); }
  const sourceTracks = midi.tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.channel !== 9 && track.notes.length);
  if (!sourceTracks.length) throw new Error('No piano notes were found in this MIDI.');
  const noteCount = sourceTracks.reduce((total, { track }) => total + track.notes.length, 0);
  if (noteCount > 250000) throw new Error('This MIDI has too many notes. Choose a smaller arrangement.');
  const scoreEnd = Math.max(...sourceTracks.map(({ track }) => track.duration));
  if (!Number.isFinite(scoreEnd) || scoreEnd > 4 * 60 * 60) throw new Error('Choose a MIDI shorter than four hours.');
  const controlsByChannel = new Map();
  // Read channel numbers directly: controller-only tracks have no note channel in Tone's Track model.
  const raw = readMidiFile(bytes);
  for (const track of raw.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type !== 'controller' || event.controllerType !== 64 || event.channel === 9) continue;
      const controls = controlsByChannel.get(event.channel) || [];
      controls.push({ time: midi.header.ticksToSeconds(tick), value: event.value / 127 });
      controlsByChannel.set(event.channel, controls);
    }
  }
  const intervalsByChannel = new Map([...controlsByChannel].map(([channel, events]) => [channel, pedalIntervals(events, scoreEnd + 1)]));
  const trackMedians = sourceTracks.map(({ track }) => median(track.notes));
  const orderedMedians = [...trackMedians].sort((a, b) => a - b);
  const split = sourceTracks.length === 2 && orderedMedians[0] !== orderedMedians[1] ? (orderedMedians[0] + orderedMedians[1]) / 2 : 60;
  const notes = [];
  const tracks = [];
  for (let index = 0; index < sourceTracks.length; index++) {
    const { track, index: sourceId } = sourceTracks[index];
    const explicitHand = namedHand(track.name);
    const assignedHand = explicitHand || (trackMedians[index] < split ? 'left' : 'right');
    const id = sourceId;
    tracks.push({ id, name: track.name.trim() || `Piano ${index + 1}`, noteCount: track.notes.length, channel: track.channel, hand: sourceTracks.length === 1 && !explicitHand ? 'mixed' : assignedHand });
    const intervals = intervalsByChannel.get(track.channel) || [];
    for (const note of track.notes) {
      if (!Number.isFinite(note.time) || !Number.isFinite(note.duration) || note.duration <= 0 || note.velocity <= 0) continue;
      const end = note.time + note.duration;
      let low = 0, high = intervals.length;
      while (low < high) { const middle = (low + high) >>> 1; if (intervals[middle][1] < end) low = middle + 1; else high = middle; }
      const pedal = intervals[low];
      const soundingEnd = pedal && pedal[0] <= end && end < pedal[1] ? pedal[1] : end;
      notes.push({ time: rounded(note.time), duration: rounded(note.duration), sustainDuration: rounded(soundingEnd - note.time), midi: note.midi, velocity: rounded(note.velocity), track: id, hand: explicitHand || (sourceTracks.length === 1 ? (note.midi < 60 ? 'left' : 'right') : assignedHand) });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi || a.track - b.track);
  if (!notes.length) throw new Error('No playable notes were found in this MIDI.');
  // Re-striking a key releases the preceding sustained voice of that key/channel.
  const nextOnsets = new Map();
  const channels = new Map(tracks.map(track => [track.id, track.channel]));
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const key = `${channels.get(note.track)}:${note.midi}`;
    const next = nextOnsets.get(key);
    if (next !== undefined && next > note.time) note.sustainDuration = rounded(Math.min(note.sustainDuration, Math.max(note.duration, next - note.time)));
    nextOnsets.set(key, note.time);
  }
  let physicalEnd = 0, soundingEnd = 0;
  for (const note of notes) {
    physicalEnd = Math.max(physicalEnd, note.time + note.duration);
    soundingEnd = Math.max(soundingEnd, note.time + note.sustainDuration);
  }
  return {
    id: stableId(bytes), title: (midi.name.trim() || filename.replace(/\.(mid|midi)$/i, '') || 'Untitled').slice(0, 160),
    filename, duration: rounded(soundingEnd + 0.8), contentDuration: rounded(physicalEnd), notes, tracks,
    pedals: [...intervalsByChannel].flatMap(([channel, intervals]) => intervals.map(([start, end]) => ({ channel, start: rounded(start), end: rounded(end) }))),
    tempos: midi.header.tempos.map(item => ({ time: rounded(item.time || 0), bpm: rounded(item.bpm) })),
    importedAt: Date.now(),
  };
}
