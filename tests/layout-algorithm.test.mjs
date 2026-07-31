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
