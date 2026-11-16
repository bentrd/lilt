import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import { PianoRenderer } from './renderer.js';
import { getExportDuration, renderAudioChunks } from './export-audio.js';

export const VIDEO_EXPORT = Object.freeze({ width:1920, height:1080, frameRate:30, sampleRate:48000, lead:2, tail:.8 });
const VIDEO_BITRATE = 5_000_000;
const AUDIO_BITRATE = 256_000;
const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));
const abortError = () => new DOMException('Video export canceled.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

/** The final frame is shortened so video and audio end on the same sample clock. */
export function frameAt(index, duration, frameRate=VIDEO_EXPORT.frameRate) {
  const timestamp=index/frameRate;
  return { timestamp, duration:Math.min(1/frameRate, Math.max(0,duration-timestamp)) };
}

async function prepareCodecs(signal) {
  const {width,height,frameRate,sampleRate}=VIDEO_EXPORT;
  checkAbort(signal);
  if (!(await canEncodeVideo('avc',{width,height,frameRate,quality:new Quality({bitrate:VIDEO_BITRATE})}))) {
    throw new Error('MP4 export needs H.264 video encoding. Open Lilt in a current Chrome, Edge, or Safari browser.');
  }
  checkAbort(signal);
  const audioOptions={numberOfChannels:2,sampleRate,quality:new Quality({bitrate:AUDIO_BITRATE})};
  if (!(await canEncodeAudio('aac',audioOptions))) {
    // The extension supplies AAC-LC when the browser only provides a video encoder.
    const {registerAacEncoder}=await import('@mediabunny/aac-encoder');
    checkAbort(signal);
    registerAacEncoder();
    if (!(await canEncodeAudio('aac',audioOptions))) throw new Error('AAC audio encoding is unavailable. Try a current Chrome, Edge, or Safari browser.');
  }
  checkAbort(signal);
}

/**
 * Render a complete song into a plain H.264/AAC MP4. All frame timestamps and audio
 * chunks share one offline clock; screen size, playback, and animation frame rate
 * cannot change the result. Returns a downloadable video/mp4 Blob.
 */
export async function exportSongVideo({song,options,buffers,speed=1,volume=.72,signal,onProgress=()=>{}}) {
  if (!song?.notes?.length || !Number.isFinite(song.duration) || song.duration<=0) throw new Error('Choose a song before exporting.');
  if (!(buffers instanceof Map) || !buffers.size) throw new Error('The piano is not ready. Try exporting again.');
  const exportSpeed=Math.max(.25,Math.min(2,Number(speed)||1));
  const {width,height,frameRate,sampleRate,lead,tail}=VIDEO_EXPORT;
  const duration=getExportDuration(song,{speed:exportSpeed,lead,tail});
  if (!Number.isFinite(duration) || duration<=0) throw new Error('This song has an invalid duration.');
  const frameCount=Math.ceil(duration*frameRate);
  onProgress({phase:'encoding',progress:0});
  await prepareCodecs(signal);
  const canvas=document.createElement('canvas');
  const target=new BufferTarget();
  // Reserve the index ahead of time: a regular, seekable MP4 without retaining
  // all encoded packets a second time as fastStart:'in-memory' would require.
  const output=new Output({format:new Mp4OutputFormat({fastStart:'reserve'}),target});
  let renderer;
  let cancellation;
  const cancel=()=>{cancellation=output.cancel().catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    checkAbort(signal);
    renderer=new PianoRenderer(canvas,{width,height,pixelRatio:1});
    renderer.setSong(song);
    renderer.setOptions({...options});
    const video=new CanvasSource(canvas,{
      codec:'avc',quality:new Quality({bitrate:VIDEO_BITRATE}),
      latencyMode:'quality',keyFrameInterval:2,contentHint:'detail',
    });
    const audio=new AudioBufferSource({codec:'aac',quality:new Quality({bitrate:AUDIO_BITRATE})});
    output.addVideoTrack(video,{frameRate,maximumPacketCount:frameCount+16});
    // AAC-LC normally emits one packet/1024 samples; reserve twice that count to
    // include priming packets and implementations that use a smaller frame size.
    output.addAudioTrack(audio,{maximumPacketCount:Math.ceil(duration*sampleRate/512)+64});
    output.setMetadataTags({
      title:song.title||'Lilt piano',
      description:'Piano in motion · Lilt',
      comment:'Piano samples: Salamander Grand Piano by Alexander Holm, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Tone.js single-velocity sample set: https://github.com/Tonejs/audio/tree/master/salamander. Visualization rendered with Lilt.',
    });
    await output.start();
    checkAbort(signal);
    let nextFrame=0;
    // Keep the two tracks close together instead of buffering the full song's
    // audio or video while waiting for the other track to arrive.
    for await (const chunk of renderAudioChunks(song,{buffers,speed:exportSpeed,volume,lead,tail,signal})) {
      checkAbort(signal);
      await audio.add(chunk.buffer);
      const chunkEnd=Math.min(duration,chunk.timestamp+chunk.buffer.duration);
      while (nextFrame<frameCount && nextFrame/frameRate<chunkEnd-1e-8) {
        checkAbort(signal);
        const frame=frameAt(nextFrame,duration,frameRate);
        renderer.draw((frame.timestamp-lead)*exportSpeed);
        await video.add(frame.timestamp,frame.duration);
        nextFrame++;
        if (nextFrame%8===0) {
          onProgress({phase:'encoding',progress:Math.min(.99,nextFrame/frameCount)});
          await yieldToPage();
        }
      }
    }
    // Rounding of chunk boundaries must not drop a final partial video frame.
    while (nextFrame<frameCount) {
      checkAbort(signal);
      const frame=frameAt(nextFrame++,duration,frameRate);
      renderer.draw((frame.timestamp-lead)*exportSpeed);
      await video.add(frame.timestamp,frame.duration);
    }
    audio.close();video.close();
    checkAbort(signal);
    onProgress({phase:'finalizing',progress:.995});
    await output.finalize();
    checkAbort(signal);
    if (!target.buffer?.byteLength) throw new Error('The video could not be completed. Try again.');
    onProgress({phase:'complete',progress:1});
    return new Blob([target.buffer],{type:'video/mp4'});
  } catch (error) {
    if (output.state!=='finalized' && output.state!=='canceled') await output.cancel().catch(()=>{});
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort',cancel);
    await cancellation;
    renderer?.destroy();
    canvas.width=canvas.height=0;
  }
}
