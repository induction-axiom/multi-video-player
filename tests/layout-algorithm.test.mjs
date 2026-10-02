import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  generateLayoutCases,
  layoutCases,
} from "../benchmarks/layout-cases.mjs";

const source = await readFile(
  new URL("../algorithm/video-layout.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { computeVideoLayout } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const videoArea = (rows) =>
  rows
    .flatMap((row) => row.tiles)
    .reduce((sum, tile) => sum + tile.width * tile.height, 0);

test("sample layouts are deterministic, bounded, and preserve aspect ratios", () => {
  for (const testCase of layoutCases) {
    const first = computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );
    const second = computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );

    assert.deepEqual(first, second, testCase.name);
    assert.ok(
      first.reduce((sum, row) => sum + row.height, 0) +
        Math.max(0, first.length - 1) * 4 <=
        testCase.height + 0.001,
      `${testCase.name} exceeds screen height`,
    );

    for (const row of first) {
      assert.ok(row.width <= testCase.width + 0.001);
      for (const tile of row.tiles) {
        const sourceVideo = testCase.videos.find(
          (video) => video.id === tile.id,
        );
        assert.ok(sourceVideo);
        assert.ok(
          Math.abs(
            tile.width / tile.height -
              sourceVideo.width / sourceVideo.height,
          ) < 1e-9,
        );
        if (row.positioned) {
          assert.ok((tile.x ?? -1) >= -0.001);
          assert.ok((tile.y ?? -1) >= -0.001);
          assert.ok((tile.x ?? 0) + tile.width <= row.width + 0.001);
          assert.ok((tile.y ?? 0) + tile.height <= row.height + 0.001);
        }
      }
      if (row.positioned) {
        for (let firstIndex = 0; firstIndex < row.tiles.length; firstIndex++) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < row.tiles.length;
            secondIndex++
          ) {
            const firstTile = row.tiles[firstIndex];
            const secondTile = row.tiles[secondIndex];
            const overlapWidth =
              Math.min(
                (firstTile.x ?? 0) + firstTile.width,
                (secondTile.x ?? 0) + secondTile.width,
              ) -
              Math.max(firstTile.x ?? 0, secondTile.x ?? 0);
            const overlapHeight =
              Math.min(
                (firstTile.y ?? 0) + firstTile.height,
                (secondTile.y ?? 0) + secondTile.height,
              ) -
              Math.max(firstTile.y ?? 0, secondTile.y ?? 0);
            assert.ok(
              overlapWidth <= 0.001 || overlapHeight <= 0.001,
              `${testCase.name} overlaps ${firstTile.id} and ${secondTile.id}`,
            );
          }
        }
      }
    }
  }
});

test("known layouts keep black area within useful bounds", () => {
  const limits = new Map([
    ["single-16x9", 0.001],
    ["four-16x9", 0.01],
    ["nine-16x9", 0.02],
    ["mixed-five", 0.25],
    ["landscape-thirteen", 0.22],
    ["mixed-thirteen", 0.15],
    ["portrait-screen-mixed", 0.35],
  ]);

  for (const testCase of layoutCases) {
    const limit = limits.get(testCase.name);
    if (limit === undefined) continue;

    const rows = computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );
    const blackRatio =
      1 - videoArea(rows) / (testCase.width * testCase.height);
    assert.ok(
      blackRatio <= limit,
      `${testCase.name} has ${(blackRatio * 100).toFixed(2)}% black area`,
    );
  }
});

test("per-video scale changes both dimensions without cropping", () => {
  const videos = [
    { id: "large", width: 1920, height: 1080, scale: 2 },
    { id: "normal", width: 1920, height: 1080, scale: 1 },
    { id: "small", width: 1920, height: 1080, scale: 0.5 },
  ];
  const rows = computeVideoLayout(videos, 2800, 400, true);
  const tiles = rows.flatMap((row) => row.tiles);
  const large = tiles.find((tile) => tile.id === "large");
  const normal = tiles.find((tile) => tile.id === "normal");
  const small = tiles.find((tile) => tile.id === "small");

  assert.ok(large);
  assert.ok(normal);
  assert.ok(small);
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(large.width / normal.width - 2) < 1e-9);
  assert.ok(Math.abs(large.height / normal.height - 2) < 1e-9);
  assert.ok(
    Math.abs(
      (large.width * large.height) / (normal.width * normal.height) - 4,
    ) < 1e-9,
  );
  assert.ok(Math.abs(small.width / normal.width - 0.5) < 1e-9);
  assert.ok(Math.abs(small.height / normal.height - 0.5) < 1e-9);
  assert.ok(
    Math.abs(
      (small.width * small.height) / (normal.width * normal.height) - 0.25,
    ) < 1e-9,
  );
  assert.ok(rows[0].width <= 2800.001);
  assert.ok(rows[0].height <= 400.001);
});

test("source resolution never changes default size or user scale", () => {
  const videos = [
    { id: "uhd", width: 3840, height: 2160, scale: 1 },
    { id: "full-hd", width: 1920, height: 1080, scale: 1 },
    { id: "uhd-half", width: 3840, height: 2160, scale: 0.5 },
  ];
  const [canvas] = computeVideoLayout(videos, 8000, 3000, true);
  const tiles = new Map(canvas.tiles.map((tile) => [tile.id, tile]));
  const uhd = tiles.get("uhd");
  const fullHd = tiles.get("full-hd");
  const uhdHalf = tiles.get("uhd-half");

  assert.ok(uhd);
  assert.ok(fullHd);
  assert.ok(uhdHalf);
  assert.ok(Math.abs(uhd.width - fullHd.width) < 1e-9);
  assert.ok(Math.abs(uhd.height - fullHd.height) < 1e-9);
  assert.ok(Math.abs(uhdHalf.width / fullHd.width - 0.5) < 1e-9);
  assert.ok(Math.abs(uhdHalf.height / fullHd.height - 0.5) < 1e-9);
});

test("fullscreen and editor layouts preserve source order", () => {
  const videos = [
    { id: "portrait-a", width: 750, height: 1000 },
    { id: "landscape-a", width: 1500, height: 1000 },
    { id: "portrait-b", width: 750, height: 1000 },
    { id: "landscape-b", width: 1333, height: 1000 },
  ];
  const sourceOrder = videos.map((video) => video.id);
  const fullscreenRows = computeVideoLayout(videos, 1920, 1080, true);
  const editorRows = computeVideoLayout(videos, 1920, 1080, false);
  const fullscreenOrder = fullscreenRows.flatMap((row) =>
    row.tiles.map((tile) => tile.id),
  );
  const editorOrder = editorRows.flatMap((row) =>
    row.tiles.map((tile) => tile.id),
  );

  assert.deepEqual(fullscreenOrder, sourceOrder);
  assert.deepEqual(editorOrder, sourceOrder);
  assert.equal(fullscreenRows.length, 1);
  assert.equal(fullscreenRows[0].positioned, true);
});

test("fullscreen shares a height across rows or a width across columns", () => {
  const videos = [
    { id: "A", width: 960, height: 1080, scale: 1 },
    { id: "B", width: 1920, height: 1080, scale: 1 },
    { id: "C", width: 1920, height: 1080, scale: 1 },
  ];
  const [canvas] = computeVideoLayout(videos, 1920, 1080, true);
  const tiles = new Map(canvas.tiles.map((tile) => [tile.id, tile]));
  const a = tiles.get("A");
  const b = tiles.get("B");
  const c = tiles.get("C");

  assert.equal(canvas.positioned, true);
  assert.ok(a);
  assert.ok(b);
  assert.ok(c);
  assert.ok(
    (Math.abs(a.height - b.height) < 0.001 && Math.abs(b.height - c.height) < 0.001) ||
    (Math.abs(a.width - b.width) < 0.001 && Math.abs(b.width - c.width) < 0.001),
  );
  assert.ok(Math.abs(a.width / a.height - 960 / 1080) < 1e-9);
  assert.ok(Math.abs(b.width / b.height - 1920 / 1080) < 1e-9);
  assert.ok(Math.abs(c.width / c.height - 1920 / 1080) < 1e-9);
});

test("fullscreen preserves a user scale across separate rows", () => {
  const videos = [
    { id: "small", width: 1920, height: 1080, scale: 0.5 },
    { id: "normal-a", width: 1920, height: 1080, scale: 1 },
    { id: "normal-b", width: 1920, height: 1080, scale: 1 },
  ];
  const [canvas] = computeVideoLayout(videos, 1920, 1080, true);
  const tiles = new Map(canvas.tiles.map((tile) => [tile.id, tile]));
  const small = tiles.get("small");
  const normalA = tiles.get("normal-a");
  const normalB = tiles.get("normal-b");

  assert.ok(small);
  assert.ok(normalA);
  assert.ok(normalB);
  assert.ok(Math.abs(small.width / normalA.width - 0.5) < 1e-9);
  assert.ok(Math.abs(small.height / normalA.height - 0.5) < 1e-9);
  assert.ok(Math.abs(normalA.width - normalB.width) < 1e-9);
  assert.ok(Math.abs(normalA.height - normalB.height) < 1e-9);
});

test("editor preserves user scales across separate rows", () => {
  const videos = [
    { id: "small", width: 1920, height: 1080, scale: 0.5 },
    { id: "normal", width: 1920, height: 1080, scale: 1 },
    { id: "large", width: 1920, height: 1080, scale: 2 },
  ];
  const rows = computeVideoLayout(videos, 1500, 800, false, {
    minimumTileWidth: 180,
  });
  const tiles = new Map(
    rows.flatMap((row) => row.tiles).map((tile) => [tile.id, tile]),
  );
  const small = tiles.get("small");
  const normal = tiles.get("normal");
  const large = tiles.get("large");

  assert.ok(rows.length > 1);
  assert.ok(small);
  assert.ok(normal);
  assert.ok(large);
  assert.ok(Math.abs(small.width / normal.width - 0.5) < 1e-9);
  assert.ok(Math.abs(small.height / normal.height - 0.5) < 1e-9);
  assert.ok(Math.abs(large.width / normal.width - 2) < 1e-9);
  assert.ok(Math.abs(large.height / normal.height - 2) < 1e-9);
  for (const row of rows) {
    assert.ok(row.width <= 1500.001);
  }
});

test("editor bounds the shared default size", () => {
  const containerWidth = 1500;
  const options = { minimumTileWidth: 180 };
  const shrunkenRows = computeVideoLayout(
    [{ id: "focus", width: 1920, height: 1080, scale: 0.125 }],
    containerWidth,
    800,
    false,
    options,
  );
  const enlargedRows = computeVideoLayout(
    [{ id: "focus", width: 1920, height: 1080, scale: 2 }],
    containerWidth,
    800,
    false,
    options,
  );
  const shrunken = shrunkenRows
    .flatMap((row) => row.tiles)
    .find((tile) => tile.id === "focus");
  const enlarged = enlargedRows
    .flatMap((row) => row.tiles)
    .find((tile) => tile.id === "focus");

  assert.ok(shrunken);
  assert.ok(enlarged);
  assert.ok(Math.abs(shrunken.width - 180) < 0.001);
  assert.ok(Math.abs(enlarged.width - (1920 / 1080) * 420 * 2) < 0.001);
  assert.ok(enlarged.width <= containerWidth);
});

test("thirteen matching aspect ratios stay equally sized at any resolution", () => {
  const testCase = layoutCases.find((entry) => entry.name === "mixed-resolutions-thirteen");
  for (const fullscreen of [false, true]) {
    const tiles = computeVideoLayout(testCase.videos, 1920, 1080, fullscreen)
      .flatMap((row) => row.tiles);
    assert.equal(tiles.length, 13);
    for (const tile of tiles) {
      assert.ok(Math.abs(tile.width - tiles[0].width) < 1e-9);
      assert.ok(Math.abs(tile.height - tiles[0].height) < 1e-9);
    }
  }
});

test("loading real metadata cannot enlarge a video with the same aspect ratio", () => {
  const placeholders = Array.from({ length: 13 }, (_, index) => ({
    id: String(index), width: 16, height: 9,
  }));
  const loaded = placeholders.map((video, index) =>
    index === 0 ? { ...video, width: 1920, height: 1080 } : video,
  );
  for (const fullscreen of [false, true]) {
    assert.deepEqual(
      computeVideoLayout(loaded, 1920, 1080, fullscreen),
      computeVideoLayout(placeholders, 1920, 1080, fullscreen),
    );
  }
});

test("mixed shapes and user scales remain visible without overlap across screen shapes", () => {
  for (const [width, height] of [[1920, 1080], [390, 844], [800, 800], [40, 20]]) {
    const cases = generateLayoutCases({ samples: 30, videos: 16, width, height, seed: 84 });
    for (const testCase of cases) {
      const videos = testCase.videos.map((video, index) => ({
        ...video,
        width: video.width * (index % 3 + 1),
        height: video.height * (index % 3 + 1),
        scale: [0.5, 1, 2][index % 3],
      }));
      const [canvas] = computeVideoLayout(videos, width, height, true);
      assert.deepEqual(canvas.tiles.map((tile) => tile.id), videos.map((video) => video.id));
      const baseHeights = canvas.tiles.map((tile, index) => tile.height / videos[index].scale);
      const baseWidths = canvas.tiles.map((tile, index) => tile.width / videos[index].scale);
      const uniform = (values) => Math.max(...values) - Math.min(...values) < 1e-6;
      assert.ok(uniform(baseHeights) || uniform(baseWidths), "an individual row was enlarged");
      for (let index = 0; index < canvas.tiles.length; index++) {
        const tile = canvas.tiles[index];
        assert.ok([tile.x, tile.y, tile.width, tile.height].every(Number.isFinite));
        assert.ok(tile.width > 0 && tile.height > 0);
        assert.ok(tile.x >= -0.001 && tile.y >= -0.001);
        assert.ok(tile.x + tile.width <= width + 0.001);
        assert.ok(tile.y + tile.height <= height + 0.001);
        assert.ok(Math.abs(tile.width / tile.height - videos[index].width / videos[index].height) < 1e-9);
        for (const other of canvas.tiles.slice(index + 1)) {
          const overlapWidth = Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
          const overlapHeight = Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
          assert.ok(overlapWidth <= 0.001 || overlapHeight <= 0.001);
        }
      }
    }
  }
});

test("empty and invalid metadata have a finite, bounded fallback", () => {
  assert.deepEqual(computeVideoLayout([], 1920, 1080, true), []);
  const videos = [
    { id: "unknown", width: 0, height: 0, scale: NaN },
    { id: "invalid", width: Infinity, height: 1080, scale: -2 },
    { id: "invalid-height", width: 1920, height: Infinity, scale: Infinity },
  ];
  const [canvas] = computeVideoLayout(videos, NaN, -100, true);
  assert.equal(canvas.tiles.length, videos.length);
  for (const tile of canvas.tiles) {
    assert.ok([tile.x, tile.y, tile.width, tile.height].every(Number.isFinite));
    assert.ok(tile.width > 0 && tile.height > 0);
    assert.ok(tile.x >= 0 && tile.y >= 0);
    assert.ok(tile.x + tile.width <= canvas.width + 0.001);
    assert.ok(tile.y + tile.height <= canvas.height + 0.001);
    assert.ok(Math.abs(tile.width / tile.height - 16 / 9) < 1e-9);
  }
});

test("one hundred videos completes in under five seconds", () => {
  const stressCase = layoutCases.find(
    (testCase) => testCase.name === "random-one-hundred",
  );
  assert.ok(stressCase);

  const startedAt = performance.now();
  computeVideoLayout(
    stressCase.videos,
    stressCase.width,
    stressCase.height,
    true,
  );
  assert.ok(performance.now() - startedAt < 5000);
});

test("generated cases are repeatable", () => {
  const options = { samples: 10, videos: 20, seed: 42 };
  const first = generateLayoutCases(options);
  const second = generateLayoutCases(options);

  assert.equal(first.length, 10);
  assert.equal(first[0].videos.length, 20);
  assert.deepEqual(first, second);
});
