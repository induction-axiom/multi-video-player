/**
 * Ordered video-wall layout
 *
 * Given videos in a fixed order and a rectangular screen, split the videos
 * into rows and maximize the visible video area. Every video keeps its aspect
 * ratio, stays inside the screen, and is never cropped.
 *
 * The row partition uses dynamic programming:
 *   state:   cost[rowCount][videoCount]
 *   choice:  where the last row starts
 *
 * The current version recomputes aspect-ratio sums inside each transition, so
 * one partition is O(r * n³). A prefix-sum array is the clearest first
 * optimization: it reduces each range sum to O(1), making the DP O(r * n²).
 * Fullscreen mode tests a small set of row counts around the estimated best.
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
};

export type VideoLayoutRow = {
  id: string;
  width: number;
  height: number;
  tiles: VideoLayoutTile[];
};

export type VideoLayoutOptions = {
  minimumTileWidth?: number;
};

type RowRange = {
  start: number;
  end: number;
};

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

export const computeVideoLayout = (
  items: VideoLayoutInput[],
  containerWidth: number,
  containerHeight: number,
  fullscreen: boolean,
  options: VideoLayoutOptions = {},
): VideoLayoutRow[] => {
  if (!items.length) return [];

  const width = Math.max(1, containerWidth);
  const aspects = items.map(safeAspectRatio);
  const scales = items.map(safeScale);
  const scaleById = new Map(
    items.map((item, index) => [item.id, scales[index]]),
  );
  const minimumTileWidth = fullscreen
    ? 0
    : Math.min(width, Math.max(0, options.minimumTileWidth ?? 0));

  if (!fullscreen) {
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
  }

  const height = Math.max(1, containerHeight);
  const columnGap = 4;
  const rowGap = 4;
  let best:
    | {
        ranges: RowRange[];
        scale: number;
        score: number;
      }
    | undefined;

  const estimatedRows = Math.max(
    1,
    Math.min(
      items.length,
      Math.round(
        Math.sqrt(
          (height * aspects.reduce((sum, value) => sum + value, 0)) / width,
        ),
      ),
    ),
  );
  const searchRadius = Math.max(3, Math.ceil(Math.sqrt(estimatedRows)));
  const candidateRowCounts = new Set<number>([1, items.length]);
  for (
    let rowCount = Math.max(1, estimatedRows - searchRadius);
    rowCount <= Math.min(items.length, estimatedRows + searchRadius);
    rowCount++
  ) {
    candidateRowCounts.add(rowCount);
  }

  for (const rowCount of [...candidateRowCounts].sort((a, b) => a - b)) {
    const availableHeight = Math.max(1, height - rowGap * (rowCount - 1));
    const targetHeight = availableHeight / rowCount;
    const ranges = partitionRows(
      aspects,
      scales,
      rowCount,
      width,
      columnGap,
      targetHeight,
    );
    if (!ranges.length) continue;

    const naturalHeights = ranges.map((range) =>
      renderedRowHeight(
        aspects,
        scales,
        range.start,
        range.end,
        width,
        columnGap,
      ),
    );
    const heightScale = Math.min(
      1,
      availableHeight /
        Math.max(1, naturalHeights.reduce((total, value) => total + value, 0)),
    );
    const videoArea = ranges.reduce((total, range, index) => {
      const largestScale = Math.max(
        ...scales.slice(range.start, range.end),
      );
      const scaledBaseHeight =
        (naturalHeights[index] / largestScale) * heightScale;
      return (
        total +
        aspects
          .slice(range.start, range.end)
          .reduce(
            (sum, aspect, tileIndex) =>
              sum +
              aspect *
                (scaledBaseHeight * scales[range.start + tileIndex]) ** 2,
            0,
          )
      );
    }, 0);
    const score =
      videoArea / (width * height) -
      rowCount * 0.00001;

    if (!best || score > best.score) {
      best = { ranges, scale: heightScale, score };
    }
  }

  return materializeRows(
    items,
    aspects,
    scales,
    best?.ranges ?? [{ start: 0, end: items.length }],
    width,
    columnGap,
    rowGap,
    best?.scale ?? 1,
  );
};
