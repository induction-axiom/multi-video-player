# Multi Video Player

Play local videos side by side on one timeline. Nothing is uploaded and no
account is needed.

[Try Multi Video Player in your browser](https://induction-axiom.github.io/multi-video-player/)

![Multi Video Player feature overview](docs/screenshots/demo.gif)

Drop in any mix of landscape, portrait, square, or ultrawide clips. The player
keeps them in sync, loops shorter clips, and fits every frame without cropping.

## Screens

| Choose files | Play together | Fullscreen |
| --- | --- | --- |
| ![Start screen](docs/screenshots/start.png) | ![Synchronized playback](docs/screenshots/player.png) | ![Fullscreen video wall](docs/screenshots/fullscreen.png) |

## What it does

- One play button and timeline for every video
- Automatic layouts for mixed aspect ratios
- Fullscreen compares rows with a shared video height and columns with a shared
  video width, then chooses the layout with less unused space. Display sizes
  depend on aspect ratio and manual scaling, not source resolution.
- Per-video display sizes that keep halving or doubling between a usable
  180px control width and the available layout width
- Per-video volume, mute, solo, and audio balancing
- Fullscreen video wall
- Local-only playback

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local address printed in the terminal, then drop in your videos.
Format support depends on the browser; MP4, MOV, and WebM usually work.

## Online version

The hosted player runs entirely in your browser. Selected videos stay on your
device and are not uploaded:

<https://induction-axiom.github.io/multi-video-player/>

## Development

```bash
npm test
npm run lint
```

## Improve the layout algorithm

Edit [`algorithm/video-layout.ts`](algorithm/video-layout.ts), then compare the
results before and after your change:

```bash
npm run test:layout
npm run benchmark:fill
```

Keep every video visible and preserve its aspect ratio and manual scale before
optimizing fill. Equal-aspect videos should have equal default sizes, including
mixed source resolutions. Never enlarge an individual row to fill a gap.

`P05 fill` and `worst fill` should go up; `P95 black` should go down. The
benchmark generates 5,000 repeatable aspect-ratio combinations by default.

MIT licensed.
