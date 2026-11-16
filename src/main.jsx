import React, {useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Glass, Slider, Switch, SegmentedControl} from 'glisse';
import {Play, Pause, SkipBack, Library, SlidersHorizontal, Plus, X, Trash2, Download, Volume2, VolumeX, Maximize, Minimize, Music2, Check, ChevronRight, RotateCcw, Github} from 'lucide-react';
import {PianoEngine} from './audio.js';
import {parseMidi} from './midi.js';
import {PianoRenderer} from './renderer.js';
import {readLibrary,saveLibrary,readOptions,saveOptions,validSong,defaultOptions} from './storage.js';
import './style.css';

const base=import.meta.env.BASE_URL;
const clock=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const icon=(Component)=><Component size={19} strokeWidth={1.65}/>;
function App(){
 const canvas=useRef(),engine=useRef(),renderer=useRef(),file=useRef(),songRef=useRef(null),playingRef=useRef(false),positionRef=useRef(0),speedRef=useRef(1),request=useRef(0),toastTimer=useRef(),seekTimer=useRef(),seekResume=useRef(false),songsRef=useRef(readLibrary()),panelRef=useRef(),panelTrigger=useRef();
 const [song,setSong]=useState(null),[demo,setDemo]=useState(null),[songs,setSongs]=useState(readLibrary),[options,setOptions]=useState(readOptions),[panel,setPanel]=useState(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[speed,setSpeed]=useState(1),[volume,setVolume]=useState(.72),[busy,setBusy]=useState(''),[notice,setNotice]=useState(null),[dragging,setDragging]=useState(false),[fullscreen,setFullscreen]=useState(false);
 const notify=(text,action)=>{clearTimeout(toastTimer.current);setNotice({text,action});toastTimer.current=setTimeout(()=>setNotice(null),6000)};
 const updatePosition=t=>{positionRef.current=t;setPosition(t)};
 const stop=()=>{clearTimeout(seekTimer.current);seekResume.current=false;++request.current;const active=playingRef.current,paused=engine.current?.pause();const t=active?(paused??positionRef.current):positionRef.current;playingRef.current=false;setPlaying(false);setBusy('');updatePosition(t);return t};
 const storeSongs=next=>{songsRef.current=next;setSongs(next);return saveLibrary(next)};
 const selectSong=(s)=>{stop();songRef.current=s;setSong(s);updatePosition(0);renderer.current?.setSong(s);setPanel(null);setBusy('')};
 useEffect(()=>{
  engine.current=new PianoEngine();engine.current.setVolume(.72);
  engine.current.onended=()=>{playingRef.current=false;setPlaying(false);updatePosition(songRef.current?.duration||0)};
  renderer.current=new PianoRenderer(canvas.current);renderer.current.setOptions(options);
  let alive=true,frame;let last=0;
  const tick=now=>{if(playingRef.current){positionRef.current=engine.current.currentTime;if(now-last>80){setPosition(positionRef.current);last=now}}renderer.current.draw(positionRef.current);frame=requestAnimationFrame(tick)};
  frame=requestAnimationFrame(tick);
  fetch(`${base}demos/sonatina.json`).then(r=>{if(!r.ok)throw Error();return r.json()}).then(s=>{if(alive){setDemo(s);if(!songRef.current){songRef.current=s;setSong(s);renderer.current.setSong(s)}}}).catch(()=>{if(alive)notify('Import a MIDI to begin')});
  return()=>{alive=false;cancelAnimationFrame(frame);engine.current.destroy();renderer.current.destroy();clearTimeout(toastTimer.current);clearTimeout(seekTimer.current)};
 },[]);
 useEffect(()=>{renderer.current?.setOptions(options);saveOptions(options)},[options]);
 useEffect(()=>{engine.current?.setVolume(volume)},[volume]);
 useEffect(()=>{const fn=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn)},[]);
 useEffect(()=>{if(panel){const previous=document.activeElement;panelTrigger.current=previous;panelRef.current?.querySelector('button')?.focus();return()=>previous?.focus?.()}},[panel]);
 const play=async(from=positionRef.current,newSpeed=speedRef.current)=>{
  clearTimeout(seekTimer.current);seekResume.current=false;const s=songRef.current;if(!s)return;
  const token=++request.current;setBusy('Preparing piano');
  try{await engine.current.prepare(s,p=>{if(request.current===token)setBusy(`Preparing piano ${Math.round(p*100)}%`)});if(token!==request.current)return;
   const start=from>=s.duration-.05?0:from;await engine.current.play(s,start,newSpeed);if(token!==request.current){engine.current.pause();return}updatePosition(start);playingRef.current=true;setPlaying(true);setBusy('');
  }catch(e){if(token===request.current){setBusy('');playingRef.current=false;setPlaying(false);notify(e.message||'Could not load the piano. Try again.')}}
 };
 const seek=t=>{const active=playingRef.current||seekResume.current;stop();updatePosition(t);if(active&&t<(songRef.current?.duration||0)-.05){seekResume.current=true;seekTimer.current=setTimeout(()=>play(t),140)}};
 const changeSpeed=v=>{const n=Number(v),active=playingRef.current||seekResume.current,t=stop();speedRef.current=n;setSpeed(n);if(active)play(t,n)};
 const importFiles=async(files)=>{
  const items=Array.from(files);if(!items.length)return;stop();setBusy('Importing');const imported=[];
  try{for(const f of items){if(f.size>10*1024*1024)throw Error('Choose a file smaller than 10 MB');let s;
    if(/\.json$/i.test(f.name)){s=JSON.parse(await f.text());if(!validSong(s))throw Error('This is not a Lilt song');s={...s,id:crypto.randomUUID(),title:s.title.slice(0,180),notes:s.notes.slice().sort((a,b)=>a.time-b.time)}}
    else s=await parseMidi(await f.arrayBuffer(),f.name);
    imported.push(s);
   }
   const fresh=[...new Map(imported.map(s=>[s.id,s])).values()];const next=[...fresh,...songsRef.current.filter(s=>!fresh.some(n=>n.id===s.id))];
   const saved=storeSongs(next);selectSong(imported[0]);notify(saved?(imported.length===1?'Added to your library':`${imported.length} songs added`):'Storage is full or unavailable. This import is available for this session.');
  }catch(e){setBusy('');notify(e.message||'That file could not be opened')}finally{file.current.value=''}
 };
 const removeSong=s=>{storeSongs(songsRef.current.filter(x=>x.id!==s.id));if(songRef.current?.id===s.id&&demo)selectSong(demo);notify('Removed from library',()=>{storeSongs([s,...songsRef.current.filter(x=>x.id!==s.id)]);setNotice(null)})};
 const downloadSong=s=>{const blob=new Blob([JSON.stringify(s)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${s.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,100)||'song'}.lilt.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 const update=(k,v)=>setOptions(o=>({...o,[k]:v}));
 const togglePanel=p=>setPanel(v=>v===p?null:p);
 useEffect(()=>{const key=e=>{if(e.key==='Escape'){setPanel(null);return}if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)&&!panel){e.preventDefault();playingRef.current?stop():play()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[panel]);
 const panelKeys=e=>{if(e.key!=='Tab')return;const nodes=panelRef.current?.querySelectorAll('button:not(:disabled),input,select,a[href]');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};
 return <div data-theme={options.background==='ivory'?'light':'dark'} className={`app theme-${options.background}`} onDragOver={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files'))setDragging(true)}} onDrop={e=>{e.preventDefault();setDragging(false);importFiles(e.dataTransfer.files)}}>
  <div className="ambient" aria-hidden="true"/>
  <header><a className="wordmark" href="#" onClick={e=>{e.preventDefault();setPanel(null)}} aria-label="Lilt home"><span className="mark" aria-hidden="true"><i/><i/><i/></span>Lilt</a><div className="header-actions"><Button icon={icon(Library)} aria-label="Open library" aria-expanded={panel==='library'} onClick={()=>togglePanel('library')}/><Button icon={icon(Plus)} aria-label="Import MIDI" onClick={()=>file.current.click()}/><Button icon={icon(SlidersHorizontal)} aria-label="Appearance" aria-expanded={panel==='appearance'} onClick={()=>togglePanel('appearance')}/><Button className="fullscreen-button" icon={icon(fullscreen?Minimize:Maximize)} aria-label={fullscreen?'Exit full screen':'Full screen'} onClick={()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.()}/></div></header>
  <main className="stage" aria-label="Piano visualization"><canvas ref={canvas} aria-label="Falling piano notes. Gold for the right hand and blue for the left hand." role="img"/></main>
  <Glass className="transport"><div className="transport-main"><Button icon={icon(SkipBack)} aria-label="Restart" onClick={()=>seek(0)} disabled={!song}/><Button variant="filled" className="play-button" icon={icon(playing?Pause:Play)} aria-label={playing?'Pause':'Play'} onClick={()=>playing?stop():play()} disabled={!song||!!busy}/><div className="now-playing"><span className="song-title">{song?.title||'Your music, in motion'}</span><span className="song-subtitle">{busy||'Salamander Grand Piano'}</span></div><label className="speed-control"><span className="sr-only">Playback speed</span><select aria-label="Playback speed" value={speed} onChange={e=>changeSpeed(e.target.value)}>{[.25,.5,.75,1,1.25,1.5,2].map(v=><option value={v} key={v}>{v}×</option>)}</select></label><div className="volume-control"><button className="plain-icon" aria-label={volume?'Mute':'Unmute'} onClick={()=>setVolume(v=>v?0:.72)}>{icon(volume?Volume2:VolumeX)}</button><Slider aria-label="Volume" min={0} max={1} step={.01} value={volume} onValueChange={setVolume}/></div></div><div className="timeline"><span>{clock(position)}</span><Slider aria-label="Song position" min={0} max={song?.duration||1} step={.01} value={position} onValueChange={seek} disabled={!song}/><span>{clock(song?.duration||0)}</span></div></Glass>
  <input className="sr-only" ref={file} type="file" accept=".mid,.midi,.kar,.json" multiple aria-label="Choose MIDI files" onChange={e=>importFiles(e.target.files)}/>
  {panel&&<><div className="panel-backdrop" onClick={()=>setPanel(null)}/><Glass className={`panel ${panel==='appearance'?'panel-right':''}`} role="dialog" aria-modal="true" aria-label={panel==='library'?'Library':'Appearance'} ref={panelRef} onKeyDown={panelKeys}><div className="panel-head"><h1>{panel==='library'?'Library':'Appearance'}</h1><Button icon={icon(X)} aria-label="Close panel" onClick={()=>setPanel(null)}/></div>
   {panel==='library'?<><Button variant="filled" className="import-button" icon={icon(Plus)} onClick={()=>file.current.click()}>Import MIDI</Button><div className="song-list">{songs.map(s=><div className={`song-row ${song?.id===s.id?'selected':''}`} key={s.id}><button className="song-choice" onClick={()=>selectSong(s)}><span className="song-art"><Music2 size={19}/></span><span><strong>{s.title}</strong><small>{clock(s.duration)}</small></span>{song?.id===s.id&&<Check size={16}/>}</button><button className="plain-icon song-action" aria-label={`Export ${s.title}`} onClick={()=>downloadSong(s)}><Download size={16}/></button><button className="plain-icon song-action" aria-label={`Remove ${s.title}`} onClick={()=>removeSong(s)}><Trash2 size={16}/></button></div>)}</div>{!songs.length&&<div className="library-empty"><Music2 size={28} strokeWidth={1}/><p>Your songs live here.</p><span>Drop a MIDI anywhere.</span></div>}{demo&&<div className="demo-section"><span className="eyebrow">Included</span><button className="demo-row" onClick={()=>selectSong(demo)}><span className="demo-art"><Music2 size={22}/></span><span><strong>Sonatina in C</strong><small>After Mozart · {clock(demo.duration)}</small></span><ChevronRight size={17}/></button></div>}<p className="local-note">Saved on this device.</p></>:<div className="settings"><section><span className="setting-label">Scene</span><SegmentedControl aria-label="Scene" items={[{value:'midnight',label:'Midnight'},{value:'ivory',label:'Pearl'},{value:'dusk',label:'Dusk'}]} value={options.background} onValueChange={v=>update('background',v)}/></section><div className="color-controls"><label>Right hand<input type="color" aria-label="Right hand color" value={options.rightColor} onChange={e=>update('rightColor',e.target.value)}/></label><label>Left hand<input type="color" aria-label="Left hand color" value={options.leftColor} onChange={e=>update('leftColor',e.target.value)}/></label></div><section><label className="setting-label" htmlFor="glow">Glow</label><Slider id="glow" aria-label="Glow" min={0} max={1} step={.01} value={options.glow} onValueChange={v=>update('glow',v)}/></section><section><label className="setting-label" htmlFor="fall-speed">Fall speed</label><Slider id="fall-speed" aria-label="Fall speed" min={2} max={8} step={.1} value={10-options.fallSpeed} onValueChange={v=>update('fallSpeed',10-v)}/></section><section><span className="setting-label">Keyboard</span><SegmentedControl aria-label="Keyboard range" items={[{value:'fit',label:'Fit song'},{value:'full',label:'88 keys'}]} value={options.range} onValueChange={v=>update('range',v)}/></section><label className="switch-row">Shimmer<Switch aria-label="Shimmer" checked={options.shimmer} onCheckedChange={v=>update('shimmer',v)}/></label><label className="switch-row">Note names<Switch aria-label="Note names" checked={options.labels} onCheckedChange={v=>update('labels',v)}/></label><button className="reset" onClick={()=>setOptions({...defaultOptions})}><RotateCcw size={14}/>Reset appearance</button><div className="credits"><a href="https://github.com/Tonejs/audio/tree/master/salamander" target="_blank" rel="noreferrer">Salamander · Alexander Holm</a><a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a><a href="https://github.com/bentrd/lilt" target="_blank" rel="noreferrer">Lilt on GitHub</a></div></div>}
  </Glass></>}
  {dragging&&<div className="drop-zone" onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false)}}><Plus size={40} strokeWidth={1}/><span>Drop your MIDI</span></div>}
  {notice&&<Glass className="toast" role="status"><span>{notice.text}</span>{notice.action&&<button onClick={notice.action}>Undo</button>}<button className="plain-icon" aria-label="Dismiss" onClick={()=>setNotice(null)}><X size={14}/></button></Glass>}
 </div>
}
createRoot(document.getElementById('root')).render(<App/>);
