import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const templateRoot = new URL("../", import.meta.url);

async function loadLayoutModule() {
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
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the player", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Multi Video Player<\/title>/);
  assert.match(html, /Drop videos here/);
});

test("fullscreen layout is deterministic, bounded, and never crops", async () => {
  const { computeVideoLayout } = await loadLayoutModule();
  const videos = [
    { id: "landscape", width: 1920, height: 1080 },
    { id: "portrait", width: 1080, height: 1920 },
    { id: "square", width: 1080, height: 1080 },
    { id: "cinema", width: 2560, height: 1080 },
    { id: "classic", width: 1440, height: 1080 },
  ];
  const first = computeVideoLayout(videos, 1912, 1072, true);
  const second = computeVideoLayout(videos, 1912, 1072, true);

  assert.deepEqual(first, second);
  assert.ok(
    first.reduce((height, row) => height + row.height, 0) +
      Math.max(0, first.length - 1) * 4 <=
      1072.001,
  );

  for (const row of first) {
    assert.ok(row.width <= 1912.001);
    for (const tile of row.tiles) {
      const source = videos.find((video) => video.id === tile.id);
      assert.ok(source);
      assert.ok(
        Math.abs(tile.width / tile.height - source.width / source.height) <
          1e-9,
      );
    }
  }
});

test("package metadata uses the product name", async () => {
  const packageJson = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  );
  assert.match(packageJson, /"name": "multi-video-player"/);
  assert.equal(templateRoot.pathname.endsWith("/"), true);
});
