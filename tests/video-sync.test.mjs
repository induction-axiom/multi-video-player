import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadVideoSyncModule() {
  const source = await readFile(
    new URL("../algorithm/video-sync.ts", import.meta.url),
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

test("maps the shared timeline onto a looping video", async () => {
  const { mediaTimeAtTimeline } = await loadVideoSyncModule();

  assert.equal(mediaTimeAtTimeline(27, 10), 7);
  assert.equal(mediaTimeAtTimeline(10, 10), 0);
});

test("leaves negligible drift at normal playback speed", async () => {
  const { planVideoSynchronization } = await loadVideoSyncModule();

  assert.deepEqual(planVideoSynchronization(4, 3.95, 10), {
    type: "set-playback-rate",
    playbackRate: 1,
  });
});

test("corrects moderate drift by adjusting playback speed", async () => {
  const { planVideoSynchronization } = await loadVideoSyncModule();

  assert.deepEqual(planVideoSynchronization(4, 3.8, 10), {
    type: "set-playback-rate",
    playbackRate: 1.02,
  });
  assert.deepEqual(planVideoSynchronization(4, 4.2, 10), {
    type: "set-playback-rate",
    playbackRate: 0.98,
  });
});

test("seeks when drift is too large for gradual correction", async () => {
  const { planVideoSynchronization } = await loadVideoSyncModule();

  assert.deepEqual(planVideoSynchronization(14, 2, 10), {
    type: "seek",
    mediaTime: 4,
  });
});

test("measures drift across a loop boundary without an unnecessary seek", async () => {
  const { planVideoSynchronization } = await loadVideoSyncModule();

  assert.deepEqual(planVideoSynchronization(10.03, 9.97, 10), {
    type: "set-playback-rate",
    playbackRate: 1,
  });
});
