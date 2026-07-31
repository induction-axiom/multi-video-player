import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { layoutCases } from "./layout-cases.mjs";

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

const option = (name) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
const requestedRuns = Number(option("runs"));
const caseFilter = option("case");
const cases = caseFilter
  ? layoutCases.filter((testCase) => testCase.name.includes(caseFilter))
  : layoutCases;

if (!cases.length) {
  throw new Error(`No benchmark case matches "${caseFilter}".`);
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
};

const layoutQuality = (rows, width, height) => {
  const videoArea = rows
    .flatMap((row) => row.tiles)
    .reduce((sum, tile) => sum + tile.width * tile.height, 0);
  const screenArea = width * height;
  const fillRatio = Math.min(1, videoArea / screenArea);

  return {
    fillRatio,
    blackRatio: 1 - fillRatio,
  };
};

const results = [];

for (const testCase of cases) {
  const runs =
    Number.isFinite(requestedRuns) && requestedRuns > 0
      ? Math.floor(requestedRuns)
      : Math.max(20, Math.round(500 / Math.sqrt(testCase.videos.length)));

  for (let index = 0; index < 5; index++) {
    computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );
  }

  const times = [];
  let rows = [];
  for (let index = 0; index < runs; index++) {
    const startedAt = performance.now();
    rows = computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );
    times.push(performance.now() - startedAt);
  }

  const quality = layoutQuality(rows, testCase.width, testCase.height);
  results.push({
    case: testCase.name,
    videos: testCase.videos.length,
    rows: rows.length,
    runs,
    "avg ms": (times.reduce((sum, time) => sum + time, 0) / runs).toFixed(3),
    "p95 ms": percentile(times, 0.95).toFixed(3),
    "video fill": `${(quality.fillRatio * 100).toFixed(2)}%`,
    "black area": `${(quality.blackRatio * 100).toFixed(2)}%`,
  });
}

console.table(results);
console.log(
  "\nBlack area = screen area - visible video area, including outer margins and gaps.",
);
