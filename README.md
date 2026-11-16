# Lilt

A quiet piano player with falling notes, Salamander sound, and a personal MIDI library.

- Import `.mid`, `.midi`, or `.kar` files, or drop them onto the piano.
- Imported songs and appearance settings stay in your browser’s localStorage.
- Play, seek, restart, change speed without changing pitch, and adjust volume.
- Choose a scene, hand colors, glow, fall speed, keyboard range, shimmer, and note names.
- Export any song as a 1080p MP4 with the current appearance and speed, stereo Salamander piano, and no interface overlays. Use the small video icon in the top toolbar; click it again to cancel.
- Export a saved song as `.lilt.json` and import it again on another device.

No account, uploads, or server are involved in importing songs. Clearing browser data removes the saved library. If localStorage is full or unavailable, the player explains that the import is available for the current session.

## Develop

```sh
npm ci
npm run dev
npm test
npm run build
```

The Vite build uses relative asset paths and runs on GitHub Pages. `dist/` is the deployable site.

## Credits

Piano: **Salamander Grand Piano**, Alexander Holm, sampled Yamaha C5. This app uses Tone.js’s compact single-velocity stereo recordings, with gain-based dynamics; it is not the full 16-layer Salamander library. Samples distributed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Original recordings are bundled locally so imported MIDI stays in the browser. See [sample credits](public/samples/README.md).

Interface components: [Glisse](https://github.com/0kzh/glisse), Kelvin Zhang, MIT. Icons: Lucide, ISC. MIDI parsing: @tonejs/midi, MIT.

Included demo: a new sonatina composed and arranged by OpenAI / Codex after Mozart K.457/I, approximately bars 31–41; it is not a work by Mozart. The public-domain source melody is transposed and developed into three movements.

App source: MIT; piano recordings retain their separate CC BY 3.0 terms.

## Video export

Exports are rendered in the browser, frame by frame, at 1920×1080 / 30 fps with H.264 video and stereo 48 kHz AAC sound. A two-second lead-in lets the first notes approach the keyboard, and the ending includes piano decay. The full song is exported from the beginning, using a snapshot of the current colors, scene, keyboard range, glow, shimmer, labels, fall speed and playback speed. Changing speed preserves pitch. A muted preview still exports piano audio at the normal volume.

Audio is mixed in eight-second sections with overlapping history for held notes and the piano compressor. Encoding yields regularly so cancellation stays available. Export requires a browser with H.264 WebCodecs encoding (current Chrome, Edge or Safari); missing native AAC support uses a bundled software AAC encoder. The completed MP4 downloads automatically and a small Save MP4 link remains available. No screen capture, microphone access, or upload is used.

MP4 creation: [Mediabunny](https://github.com/Vanilagy/mediabunny) and its AAC encoder extension, Mozilla Public License 2.0. These packages are unmodified; their source and license notices are available in the linked repository and `public/licenses/`.
