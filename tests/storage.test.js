import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLibrary,saveLibrary,readOptions,saveOptions,validSong} from '../src/storage.js';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}};
const song={id:'test',title:'Test',duration:2,notes:[{time:0,duration:1,midi:60,velocity:.8}]};
test('imported songs and settings survive a fresh read',()=>{const storage=memory();assert.equal(saveLibrary([song],storage),true);assert.deepEqual(readLibrary(storage),[song]);saveOptions({background:'ivory',glow:.2},storage);assert.equal(readOptions(storage).background,'ivory');assert.equal(readOptions(storage).glow,.2)});
test('storage corruption and quota do not crash the player',()=>{assert.deepEqual(readLibrary({getItem:()=>'{broken'}),[]);assert.equal(saveLibrary([song],{setItem(){throw Error('quota')}}),false);assert.equal(validSong({...song,notes:[{...song.notes[0],midi:NaN}]}),false)});

test('malformed JSON cannot schedule invalid sustained notes or notes outside its timeline',()=>{assert.equal(validSong({...song,notes:[null]}),false);assert.equal(validSong({...song,notes:[{...song.notes[0],sustainDuration:'bad'}]}),false);assert.equal(validSong({...song,notes:[{...song.notes[0],time:3}]}),false)});
test('browser storage denial still allows startup',()=>{Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('denied')}});assert.deepEqual(readLibrary(),[]);assert.equal(readOptions().background,'midnight');assert.equal(saveLibrary([song]),false);assert.doesNotThrow(()=>saveOptions({}));delete globalThis.localStorage});
