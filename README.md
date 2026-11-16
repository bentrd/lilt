# Lilt

A quiet piano player with falling notes, Salamander sound, and a personal MIDI library.

- Import `.mid`, `.midi`, or `.kar` files, or drop them onto the piano.
- Imported songs and appearance settings stay in your browser’s localStorage.
- Play, seek, restart, change speed without changing pitch, and adjust volume.
- Choose a scene, hand colors, glow, fall speed, keyboard range, shimmer, and note names.
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
