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

test("editor layouts keep every control card above its minimum width", () => {
  const videos = [
    { id: "square", width: 1080, height: 1080, scale: 2 },
    { id: "classic", width: 1440, height: 1080, scale: 2 },
    { id: "cinema", width: 2560, height: 1080, scale: 1 },
    { id: "landscape", width: 1920, height: 1080, scale: 2 },
    { id: "portrait", width: 1080, height: 1920, scale: 0.5 },
  ];
  const rows = computeVideoLayout(videos, 1500, 800, false, {
    minimumTileWidth: 180,
  });

  for (const row of rows) {
    assert.ok(row.width <= 1500.001);
    for (const tile of row.tiles) {
      assert.ok(tile.width >= 179.999, `${tile.id} is only ${tile.width}px wide`);
      const source = videos.find((video) => video.id === tile.id);
      assert.ok(source);
      assert.ok(
        Math.abs(tile.width / tile.height - source.width / source.height) <
          1e-9,
      );
    }
  }
});

test("editor scale can span from the control minimum to the available width", () => {
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
  assert.ok(Math.abs(enlarged.width - containerWidth) < 0.001);
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
