import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt, exportSongVideo, VIDEO_EXPORT } from '../src/export-video.js';

test('video frame timestamps cover the audio duration without accumulated drift or a long final frame',()=>{
  for (const duration of [2.8,8.123456,339.3987,14400.8]) {
    const count=Math.ceil(duration*VIDEO_EXPORT.frameRate);
    const first=frameAt(0,duration),last=frameAt(count-1,duration);
    assert.equal(first.timestamp,0);
    assert.ok(last.duration>0&&last.duration<=1/30);
    assert.ok(Math.abs(last.timestamp+last.duration-duration)<1e-9);
    const middle=frameAt(Math.floor(count/2),duration);
    assert.equal(middle.timestamp,Math.floor(count/2)/30);
  }
});

test('a canceled export exits before creating a canvas or encoder',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(exportSongVideo({song:{duration:2,notes:[{time:0,duration:1,midi:60}]},buffers:new Map([[60,{}]]),signal:controller.signal}),{name:'AbortError'});
});
