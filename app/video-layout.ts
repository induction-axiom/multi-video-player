export type VideoLayoutInput = {
  id: string;
  width: number;
  height: number;
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

type RowRange = {
  start: number;
  end: number;
};

const safeAspectRatio = (item: VideoLayoutInput) => {
  if (item.width <= 0 || item.height <= 0) return 16 / 9;
  return item.width / item.height;
};

const rowHeight = (
  aspects: number[],
  start: number,
  end: number,
  width: number,
  gap: number,
) => {
  const count = end - start;
  const availableWidth = Math.max(1, width - gap * Math.max(0, count - 1));
  let aspectSum = 0;
  for (let index = start; index < end; index++) aspectSum += aspects[index];
  return availableWidth / Math.max(0.01, aspectSum);
};

/**
 * Finds ordered row breaks with dynamic programming. Keeping source order makes
 * the result stable, while the squared height error avoids orphaned or tiny rows.
 */
const partitionRows = (
  aspects: number[],
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
        const height = rowHeight(aspects, start, end, width, gap);
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
  ranges: RowRange[],
  width: number,
  columnGap: number,
  rowGap: number,
  heightScale: number,
) =>
  ranges.map((range, rowIndex) => {
    const height =
      rowHeight(aspects, range.start, range.end, width, columnGap) * heightScale;
    const tiles = items.slice(range.start, range.end).map((item, index) => ({
      id: item.id,
      width: aspects[range.start + index] * height,
      height,
    }));
    const usedWidth =
      tiles.reduce((total, tile) => total + tile.width, 0) +
      columnGap * Math.max(0, tiles.length - 1);

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
): VideoLayoutRow[] => {
  if (!items.length) return [];

  const width = Math.max(1, containerWidth);
  const aspects = items.map(safeAspectRatio);

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
      const ranges = partitionRows(aspects, rowCount, width, gap, targetHeight);
      if (!ranges.length) continue;
      const score = ranges.reduce((total, range) => {
        const height = rowHeight(aspects, range.start, range.end, width, gap);
        const cappedHeight = Math.min(height, targetHeight * 1.28);
        const error = (cappedHeight - targetHeight) / targetHeight;
        const unusedWidth =
          Math.max(0, width - aspects.slice(range.start, range.end).reduce((a, b) => a + b, 0) * cappedHeight);
        return total + error * error + (unusedWidth / width) ** 2 * 0.18;
      }, 0);
      if (score < bestScore) {
        bestScore = score;
        bestRanges = ranges;
      }
    }

    const rows = materializeRows(items, aspects, bestRanges, width, gap, gap, 1);
    return rows.map((row) => {
      const cappedHeight = Math.min(row.height, targetHeight * 1.28, 520);
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
          height: cappedHeight,
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
      rowCount,
      width,
      columnGap,
      targetHeight,
    );
    if (!ranges.length) continue;

    const naturalHeights = ranges.map((range) =>
      rowHeight(aspects, range.start, range.end, width, columnGap),
    );
    const heightScale = Math.min(
      1,
      availableHeight /
        Math.max(1, naturalHeights.reduce((total, value) => total + value, 0)),
    );
    const videoArea = ranges.reduce((total, range, index) => {
      const scaledHeight = naturalHeights[index] * heightScale;
      const aspectSum = aspects
        .slice(range.start, range.end)
        .reduce((sum, value) => sum + value, 0);
      return total + aspectSum * scaledHeight * scaledHeight;
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
    best?.ranges ?? [{ start: 0, end: items.length }],
    width,
    columnGap,
    rowGap,
    best?.scale ?? 1,
  );
};
