import { readFile } from "node:fs/promises";
import ts from "typescript";
import { generateLayoutCases } from "./layout-cases.mjs";

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
const samples = Math.max(1, Number(option("samples")) || 1000);
const seed = Number(option("seed")) || 1;
const videoCounts = (option("videos") ?? "4,9,16,25,50")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);

if (!videoCounts.length) {
  throw new Error("Provide at least one positive video count.");
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((sorted.length - 1) * fraction);
  return sorted[index];
};

const fillRatio = (rows, width, height) => {
  const videoArea = rows
    .flatMap((row) => row.tiles)
    .reduce((sum, tile) => sum + tile.width * tile.height, 0);
  return Math.min(1, videoArea / (width * height));
};

const percent = (value) => `${(value * 100).toFixed(2)}%`;
const results = [];

for (const videos of videoCounts) {
  const cases = generateLayoutCases({ samples, videos, seed });
  const fillRates = cases.map((testCase) => {
    const rows = computeVideoLayout(
      testCase.videos,
      testCase.width,
      testCase.height,
      true,
    );
    return fillRatio(rows, testCase.width, testCase.height);
  });
  const p05Fill = percentile(fillRates, 0.05);

  results.push({
    videos,
    cases: samples,
    "average fill": percent(
      fillRates.reduce((sum, value) => sum + value, 0) / fillRates.length,
    ),
    "P05 fill": percent(p05Fill),
    "P50 fill": percent(percentile(fillRates, 0.5)),
    "P95 fill": percent(percentile(fillRates, 0.95)),
    "worst fill": percent(Math.min(...fillRates)),
    "P95 black": percent(1 - p05Fill),
  });
}

console.table(results);
console.log(
  `\nGenerated ${samples * videoCounts.length} deterministic cases with seed ${seed}.`,
);
