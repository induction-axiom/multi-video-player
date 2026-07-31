/**
 * Video-wall layout
 *
 * Editor rows preserve the file order because the controls should not jump
 * around. Fullscreen rows may reorder videos to use the screen more efficiently.
 * Every video keeps its aspect ratio, stays inside the screen, and is never
 * cropped.
 *
 * Fullscreen compares two layout families: optimized horizontal rows and
 * recursive horizontal/vertical guillotine cuts. Small mosaics enumerate
 * arbitrary cut partitions with subset DP; larger mosaics use deterministic
 * recursive candidates. The final choice directly maximizes visible video area.
 */

export type VideoLayoutInput = {
  id: string;
  width: number;
  height: number;
  scale?: number;
};

export type VideoLayoutTile = {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
};

export type VideoLayoutRow = {
  id: string;
  width: number;
  height: number;
  tiles: VideoLayoutTile[];
  positioned?: boolean;
};

export type VideoLayoutOptions = {
  minimumTileWidth?: number;
};

type RowRange = {
  start: number;
  end: number;
};

type RowMetrics = {
  height: number;
  area: number;
};

type PartitionCandidate = {
  height: number;
  area: number;
  start: number;
  end: number;
  previous?: PartitionCandidate;
};

type FullscreenLayout = {
  items: VideoLayoutInput[];
  ranges: RowRange[];
  scale: number;
  area: number;
  rowCount: number;
  orderIndex: number;
};

type SlicingTree =
  | {
      kind: "leaf";
      item: VideoLayoutInput;
      key: string;
      width: number;
      height: number;
    }
  | {
      kind: "horizontal" | "vertical";
      first: SlicingTree;
      second: SlicingTree;
      key: string;
      width: number;
      height: number;
    };

type MeasuredSlicingTree = {
  tree: SlicingTree;
  width: number;
  height: number;
  first?: MeasuredSlicingTree;
  second?: MeasuredSlicingTree;
};

const SCORE_EPSILON = 1e-9;

const safeAspectRatio = (item: VideoLayoutInput) => {
  if (item.width <= 0 || item.height <= 0) return 16 / 9;
  return item.width / item.height;
};

const safeScale = (item: VideoLayoutInput) => {
  const scale = item.scale ?? 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const rowHeight = (
  aspects: number[],
  scales: number[],
  start: number,
  end: number,
  width: number,
  gap: number,
) => {
  const count = end - start;
  const availableWidth = Math.max(1, width - gap * Math.max(0, count - 1));
  let scaledAspectSum = 0;
  for (let index = start; index < end; index++) {
    scaledAspectSum += aspects[index] * scales[index];
  }
  return availableWidth / Math.max(0.01, scaledAspectSum);
};

const renderedRowHeight = (
  aspects: number[],
  scales: number[],
  start: number,
  end: number,
  width: number,
  gap: number,
) => {
  let largestScale = 0;
  for (let index = start; index < end; index++) {
    largestScale = Math.max(largestScale, scales[index]);
  }
  return rowHeight(aspects, scales, start, end, width, gap) * largestScale;
};

const rangeMeetsMinimumWidth = (
  aspects: number[],
  scales: number[],
  start: number,
  end: number,
  width: number,
  gap: number,
  minimumTileWidth: number,
) => {
  if (minimumTileWidth <= 0) return true;
  const baseHeight = rowHeight(aspects, scales, start, end, width, gap);
  for (let index = start; index < end; index++) {
    if (aspects[index] * baseHeight * scales[index] < minimumTileWidth) {
      return false;
    }
  }
  return true;
};

const splitRangesAtMinimumWidth = (
  ranges: RowRange[],
  aspects: number[],
  scales: number[],
  width: number,
  gap: number,
  minimumTileWidth: number,
) =>
  ranges.flatMap((range) => {
    const splitRanges: RowRange[] = [];
    let start = range.start;
    while (start < range.end) {
      let end = start + 1;
      while (
        end < range.end &&
        rangeMeetsMinimumWidth(
          aspects,
          scales,
          start,
          end + 1,
          width,
          gap,
          minimumTileWidth,
        )
      ) {
        end++;
      }
      splitRanges.push({ start, end });
      start = end;
    }
    return splitRanges;
  });

/**
 * Finds ordered row breaks with dynamic programming. Keeping source order makes
 * the result stable, while the squared height error avoids orphaned or tiny rows.
 */
const partitionRows = (
  aspects: number[],
  scales: number[],
  rowCount: number,
  width: number,
  gap: number,
  targetHeight: number,
) => {
  const count = aspects.length;
  if (rowCount === 1) return [{ start: 0, end: count }];
  if (rowCount === count) {
    return aspects.map((_, index) => ({ start: index, end: index + 1 }));
  }
  const costs = Array.from({ length: rowCount + 1 }, () =>
    Array(count + 1).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: rowCount + 1 }, () =>
    Array(count + 1).fill(-1),
  );
  costs[0][0] = 0;

  for (let row = 1; row <= rowCount; row++) {
    for (let end = row; end <= count; end++) {
      for (let start = row - 1; start < end; start++) {
        if (!Number.isFinite(costs[row - 1][start])) continue;
        const height = renderedRowHeight(
          aspects,
          scales,
          start,
          end,
          width,
          gap,
        );
        const normalizedError = (height - targetHeight) / Math.max(1, targetHeight);
        const itemsInRow = end - start;
        const balanceError = itemsInRow - count / rowCount;
        const cost =
          costs[row - 1][start] +
          normalizedError * normalizedError * itemsInRow +
          balanceError * balanceError * 0.008;

        if (cost < costs[row][end]) {
          costs[row][end] = cost;
          previous[row][end] = start;
        }
      }
    }
  }

  const ranges: RowRange[] = [];
  let end = count;
  for (let row = rowCount; row > 0; row--) {
    const start = previous[row][end];
    if (start < 0) return [];
    ranges.unshift({ start, end });
    end = start;
  }
  return ranges;
};

const materializeRows = (
  items: VideoLayoutInput[],
  aspects: number[],
  scales: number[],
  ranges: RowRange[],
  width: number,
  columnGap: number,
  rowGap: number,
  heightScale: number,
) =>
  ranges.map((range, rowIndex) => {
    const baseHeight =
      rowHeight(
        aspects,
        scales,
        range.start,
        range.end,
        width,
        columnGap,
      ) * heightScale;
    const tiles = items.slice(range.start, range.end).map((item, index) => ({
      id: item.id,
      width:
        aspects[range.start + index] *
        baseHeight *
        scales[range.start + index],
      height: baseHeight * scales[range.start + index],
    }));
    const usedWidth =
      tiles.reduce((total, tile) => total + tile.width, 0) +
      columnGap * Math.max(0, tiles.length - 1);
    const height = Math.max(...tiles.map((tile) => tile.height));

    return {
      id: `row-${rowIndex}-${tiles.map((tile) => tile.id).join("-")}`,
      width: usedWidth,
      height,
      tiles,
      rowGap,
    };
  });

const createRowMetrics = (
  aspects: number[],
  scales: number[],
  width: number,
  gap: number,
) => {
  const metrics: RowMetrics[][] = Array.from(
    { length: aspects.length },
    () => [],
  );

  for (let start = 0; start < aspects.length; start++) {
    let scaledAspectSum = 0;
    let areaWeight = 0;
    let largestScale = 0;

    for (let end = start + 1; end <= aspects.length; end++) {
      const index = end - 1;
      scaledAspectSum += aspects[index] * scales[index];
      areaWeight += aspects[index] * scales[index] * scales[index];
      largestScale = Math.max(largestScale, scales[index]);
      const availableWidth = Math.max(1, width - gap * (end - start - 1));
      const baseHeight = availableWidth / Math.max(0.01, scaledAspectSum);

      metrics[start][end] = {
        height: baseHeight * largestScale,
        area: baseHeight * baseHeight * areaWeight,
      };
    }
  }

  return metrics;
};

/**
 * Removes dominated height/area trade-offs, then samples the remaining curve.
 * Sampling caps the worst-case cost while retaining candidates from both ends
 * and across the full trade-off range.
 */
const pruneFrontier = (
  candidates: PartitionCandidate[],
  maximumSize: number,
) => {
  if (candidates.length <= 1) return candidates;

  candidates.sort(
    (left, right) =>
      left.height - right.height ||
      right.area - left.area ||
      left.start - right.start,
  );

  const pareto: PartitionCandidate[] = [];
  let largestArea = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.area <= largestArea + SCORE_EPSILON) continue;
    pareto.push(candidate);
    largestArea = candidate.area;
  }

  if (pareto.length <= maximumSize) return pareto;

  const sampled: PartitionCandidate[] = [];
  const selected = new Set<number>();
  for (let index = 0; index < maximumSize; index++) {
    selected.add(
      Math.round((index * (pareto.length - 1)) / (maximumSize - 1)),
    );
  }
  for (const index of [...selected].sort((a, b) => a - b)) {
    sampled.push(pareto[index]);
  }
  return sampled;
};

const reconstructRanges = (candidate: PartitionCandidate) => {
  const ranges: RowRange[] = [];
  let current: PartitionCandidate | undefined = candidate;
  while (current?.previous) {
    ranges.unshift({ start: current.start, end: current.end });
    current = current.previous;
  }
  return ranges;
};

const fittedArea = (
  naturalArea: number,
  naturalHeight: number,
  availableHeight: number,
) => {
  const scale = Math.min(
    1,
    availableHeight / Math.max(1, naturalHeight),
  );
  return {
    area: naturalArea * scale * scale,
    scale,
  };
};

/**
 * Searches every feasible row count. Each DP state keeps several non-dominated
 * partitions instead of prematurely choosing one row-height-balanced partition.
 */
const findBestPartition = (
  items: VideoLayoutInput[],
  width: number,
  height: number,
  columnGap: number,
  rowGap: number,
  orderIndex: number,
  maximumFrontierSize: number,
) => {
  const aspects = items.map(safeAspectRatio);
  const scales = items.map(safeScale);
  const metrics = createRowMetrics(aspects, scales, width, columnGap);
  const count = items.length;
  const maxRows = Math.min(
    count,
    Math.max(1, Math.floor((height - 1) / rowGap) + 1),
  );
  const frontiers: PartitionCandidate[][][] = Array.from(
    { length: maxRows + 1 },
    () => Array.from({ length: count + 1 }, () => []),
  );
  frontiers[0][0] = [{ height: 0, area: 0, start: 0, end: 0 }];

  let best: FullscreenLayout | undefined;

  for (let rowCount = 1; rowCount <= maxRows; rowCount++) {
    for (let end = rowCount; end <= count; end++) {
      const candidates: PartitionCandidate[] = [];
      for (let start = rowCount - 1; start < end; start++) {
        const row = metrics[start][end];
        for (const previous of frontiers[rowCount - 1][start]) {
          candidates.push({
            height: previous.height + row.height,
            area: previous.area + row.area,
            start,
            end,
            previous,
          });
        }
      }
      frontiers[rowCount][end] = pruneFrontier(
        candidates,
        maximumFrontierSize,
      );
    }

    const availableHeight = Math.max(1, height - rowGap * (rowCount - 1));
    for (const candidate of frontiers[rowCount][count]) {
      const fitted = fittedArea(
        candidate.area,
        candidate.height,
        availableHeight,
      );
      const isBetter =
        !best ||
        fitted.area > best.area + SCORE_EPSILON ||
        (Math.abs(fitted.area - best.area) <= SCORE_EPSILON &&
          (rowCount < best.rowCount ||
            (rowCount === best.rowCount && orderIndex < best.orderIndex)));

      if (isBetter) {
        best = {
          items,
          ranges: reconstructRanges(candidate),
          scale: fitted.scale,
          area: fitted.area,
          rowCount,
          orderIndex,
        };
      }
    }
  }

  return best;
};

const createFullscreenOrders = (items: VideoLayoutInput[]) => {
  const sourceIndexes = new Map(items.map((item, index) => [item.id, index]));
  const compareByWidth = (left: VideoLayoutInput, right: VideoLayoutInput) =>
    safeAspectRatio(left) * safeScale(left) -
      safeAspectRatio(right) * safeScale(right) ||
    (sourceIndexes.get(left.id) ?? 0) - (sourceIndexes.get(right.id) ?? 0);
  const ascending = [...items].sort(compareByWidth);
  const descending = [...ascending].reverse();
  const alternating: VideoLayoutInput[] = [];

  for (let low = 0, high = ascending.length - 1; low <= high; low++, high--) {
    alternating.push(ascending[high]);
    if (low < high) alternating.push(ascending[low]);
  }

  const orders =
    items.length > 40
      ? [items, alternating]
      : items.length > 24
        ? [items, ascending, alternating]
        : [items, ascending, descending, alternating];
  const unique = new Map<string, VideoLayoutInput[]>();
  for (const order of orders) {
    const key = order.map((item) => item.id).join("\u0000");
    if (!unique.has(key)) unique.set(key, order);
  }
  return [...unique.values()];
};

const metricsForItems = (
  items: VideoLayoutInput[],
  width: number,
  gap: number,
): RowMetrics => {
  let scaledAspectSum = 0;
  let areaWeight = 0;
  let largestScale = 0;

  for (const item of items) {
    const aspect = safeAspectRatio(item);
    const scale = safeScale(item);
    scaledAspectSum += aspect * scale;
    areaWeight += aspect * scale * scale;
    largestScale = Math.max(largestScale, scale);
  }

  const availableWidth = Math.max(1, width - gap * (items.length - 1));
  const baseHeight = availableWidth / Math.max(0.01, scaledAspectSum);
  return {
    height: baseHeight * largestScale,
    area: baseHeight * baseHeight * areaWeight,
  };
};

/**
 * Small mosaics are where ordering mistakes hurt most, so exhaustively enumerate
 * unordered row groups there. Fixing the lowest remaining source index in each
 * next group removes row-order duplicates (Bell-number rather than n! search).
 */
const findExactSmallLayout = (
  items: VideoLayoutInput[],
  width: number,
  height: number,
  columnGap: number,
  rowGap: number,
) => {
  const count = items.length;
  const fullMask = (1 << count) - 1;
  const subsetItems: VideoLayoutInput[][] = Array.from(
    { length: fullMask + 1 },
    () => [],
  );
  const subsetMetrics: RowMetrics[] = Array(fullMask + 1);

  for (let mask = 1; mask <= fullMask; mask++) {
    const group = items.filter((_, index) => mask & (1 << index));
    subsetItems[mask] = group;
    subsetMetrics[mask] = metricsForItems(group, width, columnGap);
  }

  let best:
    | {
        masks: number[];
        area: number;
        scale: number;
      }
    | undefined;
  const masks: number[] = [];

  const visit = (
    remaining: number,
    naturalHeight: number,
    naturalArea: number,
  ) => {
    if (remaining === 0) {
      const availableHeight =
        height - rowGap * Math.max(0, masks.length - 1);
      if (availableHeight < 1) return;
      const fitted = fittedArea(
        naturalArea,
        naturalHeight,
        availableHeight,
      );
      if (
        !best ||
        fitted.area > best.area + SCORE_EPSILON ||
        (Math.abs(fitted.area - best.area) <= SCORE_EPSILON &&
          masks.length < best.masks.length)
      ) {
        best = {
          masks: [...masks],
          area: fitted.area,
          scale: fitted.scale,
        };
      }
      return;
    }

    const firstBit = remaining & -remaining;
    for (
      let subset = remaining;
      subset > 0;
      subset = (subset - 1) & remaining
    ) {
      if (!(subset & firstBit)) continue;
      const row = subsetMetrics[subset];
      masks.push(subset);
      visit(
        remaining ^ subset,
        naturalHeight + row.height,
        naturalArea + row.area,
      );
      masks.pop();
    }
  };

  visit(fullMask, 0, 0);
  if (!best) return undefined;

  const groups = best.masks.map((mask) => subsetItems[mask]);
  const reorderedItems = groups.flat();
  let start = 0;
  const ranges = groups.map((group) => {
    const range = { start, end: start + group.length };
    start = range.end;
    return range;
  });

  return {
    items: reorderedItems,
    ranges,
    scale: best.scale,
    area: best.area,
    rowCount: groups.length,
    orderIndex: -1,
  } satisfies FullscreenLayout;
};

/**
 * A few cross-row swaps recover groupings that no one-dimensional order can
 * represent. Row count and item counts stay fixed, keeping this deterministic
 * and inexpensive compared with unrestricted two-dimensional packing.
 */
const improveBySwapping = (
  layout: FullscreenLayout,
  width: number,
  height: number,
  columnGap: number,
  rowGap: number,
) => {
  if (layout.ranges.length < 2 || layout.items.length > 120) return layout;

  const groups = layout.ranges.map((range) =>
    layout.items.slice(range.start, range.end),
  );
  const availableHeight = Math.max(
    1,
    height - rowGap * (groups.length - 1),
  );
  const rowMetrics = groups.map((group) =>
    metricsForItems(group, width, columnGap),
  );
  let naturalHeight = rowMetrics.reduce((sum, row) => sum + row.height, 0);
  let naturalArea = rowMetrics.reduce((sum, row) => sum + row.area, 0);
  let current = fittedArea(naturalArea, naturalHeight, availableHeight);

  for (let iteration = 0; iteration < 6; iteration++) {
    let bestSwap:
      | {
          firstRow: number;
          firstIndex: number;
          secondRow: number;
          secondIndex: number;
          firstMetrics: RowMetrics;
          secondMetrics: RowMetrics;
          naturalHeight: number;
          naturalArea: number;
          fittedArea: number;
        }
      | undefined;

    for (let firstRow = 0; firstRow < groups.length - 1; firstRow++) {
      for (let secondRow = firstRow + 1; secondRow < groups.length; secondRow++) {
        for (
          let firstIndex = 0;
          firstIndex < groups[firstRow].length;
          firstIndex++
        ) {
          for (
            let secondIndex = 0;
            secondIndex < groups[secondRow].length;
            secondIndex++
          ) {
            const firstItem = groups[firstRow][firstIndex];
            groups[firstRow][firstIndex] = groups[secondRow][secondIndex];
            groups[secondRow][secondIndex] = firstItem;

            const firstMetrics = metricsForItems(
              groups[firstRow],
              width,
              columnGap,
            );
            const secondMetrics = metricsForItems(
              groups[secondRow],
              width,
              columnGap,
            );
            const nextNaturalHeight =
              naturalHeight -
              rowMetrics[firstRow].height -
              rowMetrics[secondRow].height +
              firstMetrics.height +
              secondMetrics.height;
            const nextNaturalArea =
              naturalArea -
              rowMetrics[firstRow].area -
              rowMetrics[secondRow].area +
              firstMetrics.area +
              secondMetrics.area;
            const nextFitted = fittedArea(
              nextNaturalArea,
              nextNaturalHeight,
              availableHeight,
            );

            if (
              nextFitted.area > current.area + SCORE_EPSILON &&
              (!bestSwap ||
                nextFitted.area > bestSwap.fittedArea + SCORE_EPSILON)
            ) {
              bestSwap = {
                firstRow,
                firstIndex,
                secondRow,
                secondIndex,
                firstMetrics,
                secondMetrics,
                naturalHeight: nextNaturalHeight,
                naturalArea: nextNaturalArea,
                fittedArea: nextFitted.area,
              };
            }

            groups[secondRow][secondIndex] = groups[firstRow][firstIndex];
            groups[firstRow][firstIndex] = firstItem;
          }
        }
      }
    }

    if (!bestSwap) break;
    const firstItem = groups[bestSwap.firstRow][bestSwap.firstIndex];
    groups[bestSwap.firstRow][bestSwap.firstIndex] =
      groups[bestSwap.secondRow][bestSwap.secondIndex];
    groups[bestSwap.secondRow][bestSwap.secondIndex] = firstItem;
    rowMetrics[bestSwap.firstRow] = bestSwap.firstMetrics;
    rowMetrics[bestSwap.secondRow] = bestSwap.secondMetrics;
    naturalHeight = bestSwap.naturalHeight;
    naturalArea = bestSwap.naturalArea;
    current = fittedArea(naturalArea, naturalHeight, availableHeight);
  }

  const reorderedItems = groups.flat();
  let start = 0;
  const ranges = groups.map((group) => {
    const range = { start, end: start + group.length };
    start = range.end;
    return range;
  });

  return {
    ...layout,
    items: reorderedItems,
    ranges,
    scale: current.scale,
    area: current.area,
  };
};

// Recursive horizontal/vertical slicing for fullscreen layouts.

const createSlicingLeaf = (item: VideoLayoutInput): SlicingTree => {
  const scale = safeScale(item);
  return {
    kind: "leaf",
    item,
    key: item.id,
    width: safeAspectRatio(item) * scale,
    height: scale,
  };
};

const createSlicingCut = (
  kind: "horizontal" | "vertical",
  first: SlicingTree,
  second: SlicingTree,
): SlicingTree => ({
  kind,
  first,
  second,
  key: `${kind === "horizontal" ? "H" : "V"}(${first.key},${second.key})`,
  width:
    kind === "horizontal"
      ? first.width + second.width
      : Math.max(first.width, second.width),
  height:
    kind === "vertical"
      ? first.height + second.height
      : Math.max(first.height, second.height),
});

const scaleSlicingGeometry = (
  tree: SlicingTree,
  factor: number,
): SlicingTree => {
  if (tree.kind === "leaf") {
    return {
      ...tree,
      width: tree.width * factor,
      height: tree.height * factor,
    };
  }
  return createSlicingCut(
    tree.kind,
    scaleSlicingGeometry(tree.first, factor),
    scaleSlicingGeometry(tree.second, factor),
  );
};

/**
 * With uniform user scales, sibling subtrees can be normalized along their
 * shared edge. This is what lets one tile span the height of two stacked tiles.
 */
const normalizeSlicingTree = (tree: SlicingTree): SlicingTree => {
  if (tree.kind === "leaf") {
    return {
      ...tree,
      width: safeAspectRatio(tree.item),
      height: 1,
    };
  }

  let first = normalizeSlicingTree(tree.first);
  let second = normalizeSlicingTree(tree.second);
  if (tree.kind === "horizontal") {
    first = scaleSlicingGeometry(first, 1 / first.height);
    second = scaleSlicingGeometry(second, 1 / second.height);
  } else {
    first = scaleSlicingGeometry(first, 1 / first.width);
    second = scaleSlicingGeometry(second, 1 / second.width);
  }
  return createSlicingCut(tree.kind, first, second);
};

/**
 * Keeps the non-dominated width/height curve for a subset. A bounded sample of
 * that curve prevents the subset DP from exploding on ten-video mosaics.
 */
const pruneSlicingTrees = (
  candidates: SlicingTree[],
  maximumSize: number,
) => {
  if (candidates.length <= 1) return candidates;

  candidates.sort(
    (left, right) =>
      left.width - right.width ||
      left.height - right.height ||
      left.key.localeCompare(right.key),
  );

  const pareto: SlicingTree[] = [];
  let smallestHeight = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.height >= smallestHeight - SCORE_EPSILON) continue;
    pareto.push(candidate);
    smallestHeight = candidate.height;
  }
  if (pareto.length <= maximumSize) return pareto;

  const sampled: SlicingTree[] = [];
  const selected = new Set<number>();
  for (let index = 0; index < maximumSize; index++) {
    selected.add(
      Math.round((index * (pareto.length - 1)) / (maximumSize - 1)),
    );
  }
  for (const index of [...selected].sort((a, b) => a - b)) {
    sampled.push(pareto[index]);
  }
  return sampled;
};

/**
 * Enumerates arbitrary item subsets and both cut directions. This is exact
 * before Pareto-frontier sampling and is intentionally limited to small walls.
 */
const createSubsetSlicingTrees = (items: VideoLayoutInput[]) => {
  const count = items.length;
  const fullMask = (1 << count) - 1;
  const maximumSize = 96;
  const states: SlicingTree[][] = Array.from(
    { length: fullMask + 1 },
    () => [],
  );

  for (let index = 0; index < count; index++) {
    states[1 << index] = [createSlicingLeaf(items[index])];
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    if ((mask & (mask - 1)) === 0) continue;
    const firstBit = mask & -mask;
    let candidates: SlicingTree[] = [];

    for (
      let firstMask = (mask - 1) & mask;
      firstMask > 0;
      firstMask = (firstMask - 1) & mask
    ) {
      if (!(firstMask & firstBit)) continue;
      const secondMask = mask ^ firstMask;
      if (!secondMask) continue;

      for (const first of states[firstMask]) {
        for (const second of states[secondMask]) {
          candidates.push(
            createSlicingCut("horizontal", first, second),
            createSlicingCut("vertical", first, second),
          );
        }
      }

      if (candidates.length > maximumSize * 12) {
        candidates = pruneSlicingTrees(candidates, maximumSize);
      }
    }

    states[mask] = pruneSlicingTrees(candidates, maximumSize);
  }

  return states[fullMask];
};

const createHeuristicSlicingTrees = (
  items: VideoLayoutInput[],
  width: number,
  height: number,
) => {
  const trees = new Map<string, SlicingTree>();
  const orders = createFullscreenOrders(items);

  const build = (
    group: VideoLayoutInput[],
    horizontal: boolean,
    balanceByArea: boolean,
  ): SlicingTree => {
    if (group.length === 1) return createSlicingLeaf(group[0]);

    let split = Math.ceil(group.length / 2);
    if (balanceByArea) {
      const weights = group.map(
        (item) =>
          safeAspectRatio(item) * safeScale(item) * safeScale(item),
      );
      const target = weights.reduce((sum, value) => sum + value, 0) / 2;
      let sum = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < group.length; index++) {
        sum += weights[index - 1];
        const distance = Math.abs(sum - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          split = index;
        }
      }
    }

    return createSlicingCut(
      horizontal ? "horizontal" : "vertical",
      build(group.slice(0, split), !horizontal, balanceByArea),
      build(group.slice(split), !horizontal, balanceByArea),
    );
  };

  for (const order of orders) {
    for (const rootHorizontal of [width >= height, width < height]) {
      for (const balanceByArea of [false, true]) {
        const tree = build(order, rootHorizontal, balanceByArea);
        trees.set(tree.key, tree);
      }
    }
  }
  return [...trees.values()];
};

const measureSlicingTree = (
  tree: SlicingTree,
  scale: number,
  gap: number,
): MeasuredSlicingTree => {
  if (tree.kind === "leaf") {
    return {
      tree,
      width: tree.width * scale,
      height: tree.height * scale,
    };
  }

  const first = measureSlicingTree(tree.first, scale, gap);
  const second = measureSlicingTree(tree.second, scale, gap);
  return {
    tree,
    first,
    second,
    width:
      tree.kind === "horizontal"
        ? first.width + gap + second.width
        : Math.max(first.width, second.width),
    height:
      tree.kind === "vertical"
        ? first.height + gap + second.height
        : Math.max(first.height, second.height),
  };
};

const largestSlicingScale = (
  tree: SlicingTree,
  width: number,
  height: number,
  gap: number,
) => {
  let high = Number.POSITIVE_INFINITY;
  const visit = (node: SlicingTree) => {
    if (node.kind === "leaf") {
      high = Math.min(
        high,
        width / node.width,
        height / node.height,
      );
      return;
    }
    visit(node.first);
    visit(node.second);
  };
  visit(tree);
  if (!Number.isFinite(high) || high <= 0) return 0;

  const minimum = measureSlicingTree(tree, 0, gap);
  if (minimum.width > width || minimum.height > height) return 0;

  let low = 0;
  for (let iteration = 0; iteration < 48; iteration++) {
    const middle = (low + high) / 2;
    const measured = measureSlicingTree(tree, middle, gap);
    if (measured.width <= width && measured.height <= height) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
};

const placeMeasuredSlicingTree = (
  measured: MeasuredSlicingTree,
  x: number,
  y: number,
  gap: number,
  tiles: VideoLayoutTile[],
) => {
  if (measured.tree.kind === "leaf") {
    tiles.push({
      id: measured.tree.item.id,
      x,
      y,
      width: measured.width,
      height: measured.height,
    });
    return;
  }

  const first = measured.first;
  const second = measured.second;
  if (!first || !second) return;

  if (measured.tree.kind === "horizontal") {
    placeMeasuredSlicingTree(
      first,
      x,
      y + (measured.height - first.height) / 2,
      gap,
      tiles,
    );
    placeMeasuredSlicingTree(
      second,
      x + first.width + gap,
      y + (measured.height - second.height) / 2,
      gap,
      tiles,
    );
  } else {
    placeMeasuredSlicingTree(
      first,
      x + (measured.width - first.width) / 2,
      y,
      gap,
      tiles,
    );
    placeMeasuredSlicingTree(
      second,
      x + (measured.width - second.width) / 2,
      y + first.height + gap,
      gap,
      tiles,
    );
  }
};

const materializeSlicingCanvas = (
  tree: SlicingTree,
  scale: number,
  width: number,
  height: number,
  gap: number,
): VideoLayoutRow => {
  const measured = measureSlicingTree(tree, scale, gap);
  const tiles: VideoLayoutTile[] = [];
  placeMeasuredSlicingTree(
    measured,
    (width - measured.width) / 2,
    (height - measured.height) / 2,
    gap,
    tiles,
  );
  return {
    id: `canvas-${tree.key}`,
    width,
    height,
    positioned: true,
    tiles,
  };
};

const materializeRowCanvas = (
  rows: VideoLayoutRow[],
  width: number,
  height: number,
  rowGap: number,
): VideoLayoutRow => {
  const usedHeight =
    rows.reduce((sum, row) => sum + row.height, 0) +
    rowGap * Math.max(0, rows.length - 1);
  const tiles: VideoLayoutTile[] = [];
  let y = (height - usedHeight) / 2;

  for (const row of rows) {
    let x = (width - row.width) / 2;
    for (const tile of row.tiles) {
      tiles.push({
        ...tile,
        x,
        y: y + (row.height - tile.height) / 2,
      });
      x += tile.width + 4;
    }
    y += row.height + rowGap;
  }

  return {
    id: `canvas-rows-${rows.map((row) => row.id).join("-")}`,
    width,
    height,
    positioned: true,
    tiles,
  };
};

const visibleVideoArea = (tiles: VideoLayoutTile[]) =>
  tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);

const computeEditorLayout = (
  items: VideoLayoutInput[],
  width: number,
  options: VideoLayoutOptions,
) => {
  const aspects = items.map(safeAspectRatio);
  const scales = items.map(safeScale);
  const scaleById = new Map(
    items.map((item, index) => [item.id, scales[index]]),
  );
  const minimumTileWidth = Math.min(
    width,
    Math.max(0, options.minimumTileWidth ?? 0),
  );
  const gap = 6;
  const targetHeight = Math.min(
    420,
    Math.max(210, width / (Math.ceil(Math.sqrt(items.length)) * 1.65)),
  );
  const estimatedRows = Math.max(
    1,
    Math.min(
      items.length,
      Math.round(
        (aspects.reduce((a, b) => a + b, 0) * targetHeight) / width,
      ),
    ),
  );

  let bestRanges: RowRange[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  const minRows = Math.max(1, estimatedRows - 2);
  const maxRows = Math.min(items.length, estimatedRows + 2);

  for (let rowCount = minRows; rowCount <= maxRows; rowCount++) {
    const ranges = partitionRows(
      aspects,
      scales,
      rowCount,
      width,
      gap,
      targetHeight,
    );
    if (!ranges.length) continue;
    const score = ranges.reduce((total, range) => {
      const height = renderedRowHeight(
        aspects,
        scales,
        range.start,
        range.end,
        width,
        gap,
      );
      const cappedHeight = Math.min(height, targetHeight * 1.28);
      const error = (cappedHeight - targetHeight) / targetHeight;
      const largestScale = Math.max(
        ...scales.slice(range.start, range.end),
      );
      const baseHeight = cappedHeight / largestScale;
      const unusedWidth =
        Math.max(
          0,
          width -
            aspects
              .slice(range.start, range.end)
              .reduce(
                (sum, aspect, index) =>
                  sum + aspect * scales[range.start + index],
                0,
              ) *
              baseHeight,
        );
      return total + error * error + (unusedWidth / width) ** 2 * 0.18;
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      bestRanges = ranges;
    }
  }

  const constrainedRanges =
    minimumTileWidth > 0
      ? splitRangesAtMinimumWidth(
          bestRanges,
          aspects,
          scales,
          width,
          gap,
          minimumTileWidth,
        )
      : bestRanges;
  const rows = materializeRows(
    items,
    aspects,
    scales,
    constrainedRanges,
    width,
    gap,
    gap,
    1,
  );
  return rows.map((row) => {
    const largestScale = Math.max(
      ...row.tiles.map((tile) => scaleById.get(tile.id) ?? 1),
    );
    const minimumRenderedHeight =
      minimumTileWidth <= 0
        ? 0
        : Math.max(
            ...row.tiles.map(
              (tile) => (minimumTileWidth * row.height) / tile.width,
            ),
          );
    const cappedHeight = Math.min(
      row.height,
      Math.max(
        targetHeight * 1.28 * largestScale,
        minimumRenderedHeight,
      ),
    );
    if (cappedHeight === row.height) return row;
    const scale = cappedHeight / row.height;
    return {
      ...row,
      width:
        row.tiles.reduce((total, tile) => total + tile.width * scale, 0) +
        gap * Math.max(0, row.tiles.length - 1),
      height: cappedHeight,
      tiles: row.tiles.map((tile) => ({
        ...tile,
        width: tile.width * scale,
        height: tile.height * scale,
      })),
    };
  });
};

const computeFullscreenLayout = (
  items: VideoLayoutInput[],
  width: number,
  height: number,
) => {
  const gap = 4;
  const scales = items.map(safeScale);
  let best =
    items.length <= 10
      ? findExactSmallLayout(
          items,
          width,
          height,
          gap,
          gap,
        )
      : undefined;
  const orders = best ? [] : createFullscreenOrders(items);
  const maximumFrontierSize =
    items.length > 60 ? 4 : items.length > 30 ? 6 : 24;

  for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
    const candidate = findBestPartition(
      orders[orderIndex],
      width,
      height,
      gap,
      gap,
      orderIndex,
      maximumFrontierSize,
    );
    if (
      candidate &&
      (!best ||
        candidate.area > best.area + SCORE_EPSILON ||
        (Math.abs(candidate.area - best.area) <= SCORE_EPSILON &&
          (candidate.rowCount < best.rowCount ||
            (candidate.rowCount === best.rowCount &&
              candidate.orderIndex < best.orderIndex))))
    ) {
      best = candidate;
    }
  }

  if (best) best = improveBySwapping(best, width, height, gap, gap);

  const orderedItems = best?.items ?? items;
  const rowLayout = materializeRows(
    orderedItems,
    orderedItems.map(safeAspectRatio),
    orderedItems.map(safeScale),
    best?.ranges ?? [{ start: 0, end: items.length }],
    width,
    gap,
    gap,
    best?.scale ?? 1,
  );
  let bestCanvas = materializeRowCanvas(rowLayout, width, height, gap);
  let bestArea = visibleVideoArea(bestCanvas.tiles);
  const slicingTrees =
    items.length <= 8
      ? createSubsetSlicingTrees(items)
      : createHeuristicSlicingTrees(items, width, height);
  const scalesAreUniform = scales.every(
    (scale) => Math.abs(scale - scales[0]) <= SCORE_EPSILON,
  );
  const candidateTrees = scalesAreUniform
    ? slicingTrees.flatMap((tree) => [tree, normalizeSlicingTree(tree)])
    : slicingTrees;

  for (const tree of candidateTrees) {
    const scale = largestSlicingScale(tree, width, height, gap);
    const canvas = materializeSlicingCanvas(
      tree,
      scale,
      width,
      height,
      gap,
    );
    const area = visibleVideoArea(canvas.tiles);
    if (area <= bestArea + SCORE_EPSILON) continue;
    bestCanvas = canvas;
    bestArea = area;
  }

  return [bestCanvas];
};

export const computeVideoLayout = (
  items: VideoLayoutInput[],
  containerWidth: number,
  containerHeight: number,
  fullscreen: boolean,
  options: VideoLayoutOptions = {},
): VideoLayoutRow[] => {
  if (!items.length) return [];

  const width = Math.max(1, containerWidth);
  if (!fullscreen) return computeEditorLayout(items, width, options);
  return computeFullscreenLayout(
    items,
    width,
    Math.max(1, containerHeight),
  );
};
