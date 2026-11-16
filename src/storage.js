export const LIBRARY_KEY = 'lilt.library.v1';
export const SETTINGS_KEY = 'lilt.appearance.v1';
export const defaultOptions = { background:'midnight', rightColor:'#edc18a', leftColor:'#8dbedb', glow:0.65, fallSpeed:4.5, labels:false, range:'fit', shimmer:true };
export function readLibrary(storage) {
  try { storage ??= globalThis.localStorage; const songs=JSON.parse(storage.getItem(LIBRARY_KEY)||'[]'); return Array.isArray(songs)?songs.filter(validSong):[]; } catch { return []; }
}
export function validSong(s) {
  return s && typeof s.id==='string' && s.id.length<=200 && typeof s.title==='string' && s.title.length<=500 && Number.isFinite(s.duration) && s.duration>0 && s.duration<=14400 && Array.isArray(s.notes) && s.notes.length>0 && s.notes.length<=250000 && s.notes.every(n=>n&&Number.isFinite(n.time)&&n.time>=0&&Number.isFinite(n.duration)&&n.duration>0&&Number.isInteger(n.midi)&&n.midi>=0&&n.midi<=127&&Number.isFinite(n.velocity)&&n.velocity>0&&n.velocity<=1&&(n.sustainDuration===undefined||(Number.isFinite(n.sustainDuration)&&n.sustainDuration>=n.duration))&&n.time+(n.sustainDuration??n.duration)<=s.duration+.00001);
}
export function saveLibrary(songs,storage) {
  try { storage ??= globalThis.localStorage; storage.setItem(LIBRARY_KEY,JSON.stringify(songs)); return true; } catch { return false; }
}
export function readOptions(storage) {
  try { storage ??= globalThis.localStorage; const s=JSON.parse(storage.getItem(SETTINGS_KEY)||'{}')||{};
    return {...defaultOptions,
      background:['midnight','ivory','dusk'].includes(s.background)?s.background:defaultOptions.background,
      ...Object.fromEntries(['rightColor','leftColor'].filter(k=>/^#[0-9a-f]{6}$/i.test(s[k])).map(k=>[k,s[k]])),
      glow:Number.isFinite(s.glow)?Math.max(0,Math.min(1,s.glow)):defaultOptions.glow,
      fallSpeed:Number.isFinite(s.fallSpeed)?Math.max(2,Math.min(8,s.fallSpeed)):defaultOptions.fallSpeed,
      range:s.range==='full'?'full':'fit',labels:s.labels===true,shimmer:s.shimmer!==false};
  } catch{return {...defaultOptions};}
}
export function saveOptions(options,storage) { try {storage ??= globalThis.localStorage;storage.setItem(SETTINGS_KEY,JSON.stringify(options));}catch{/* Session controls remain usable when storage is unavailable. */} }
