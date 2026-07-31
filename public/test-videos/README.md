# Test videos

These five short, real-world clips form a scenic nature set with deliberately
varied layout inputs: 16:9, 9:16, 1:1, 4:3, and 20:9. Every bundled file has
recorded sound for synchronized playback, volume, mute, solo, and balancing
tests. The tracks contain bird song, falling water, forest ambience, or waves
rather than speech or music.

The machine-readable [`manifest.json`](manifest.json) contains the public URL,
video and audio metadata, measured audio levels, SHA-256 checksum, original
download URL, creator, license, original resolution, duration, size, and all
modifications for every clip. Applications can load the fixtures with:

```js
const { assets } = await fetch("/test-videos/manifest.json").then((response) =>
  response.json(),
);

const videoUrls = assets.map((asset) => asset.path);
```

## Bundled files

| File | Ratio | Resolution | Duration | Size | Audio |
| --- | ---: | ---: | ---: | ---: | --- |
| `robin-singing-16x9.mp4` | 16:9 | 1280×720 | 12.000 s | 2,205,765 bytes | Robin song |
| `waterfall-9x16.mp4` | 9:16 | 540×960 | 10.000 s | 3,693,682 bytes | Falling water |
| `beech-forest-square.mp4` | 1:1 | 720×720 | 11.000 s | 2,710,460 bytes | Forest ambience |
| `ocean-waves-4x3.mp4` | 4:3 | 960×720 | 9.000 s | 1,983,893 bytes | Ocean waves |
| `clackamas-river-20x9.mp4` | 20:9 | 1280×576 | 10.000 s | 1,870,005 bytes | River and waterfall |

All files use H.264/yuv420p video at 24 fps and AAC 48 kHz stereo audio. The
quiet forest and river recordings were raised by 9 dB and 18 dB respectively
so they remain useful in audio-control tests. No audio content was replaced.

## License and reuse

The repository's MIT license does not replace the individual video licenses.
Each bundled clip remains under the license recorded in its manifest entry.

- The robin clip is CC BY 2.0.
- The forest and ocean clips are CC BY-SA 4.0 derivatives.
- The Geroldsau waterfall clip is CC0 1.0.
- The Clackamas clip is a U.S. Bureau of Land Management work identified as
  public domain in the United States; its source page also offers CC BY 2.0.

Preserve the attribution, license links, and modification notices in the
manifest when redistributing the clips. Further adaptations of CC BY-SA
material must use the same or a compatible license.

The manifest is the canonical inventory. If a file is regenerated, update its
bundled metadata, measured audio levels, and SHA-256 value there.
