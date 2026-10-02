/**
 * Videos keep their aspect ratios and user scales, independently of resolution.
 * Fullscreen compares ordered rows with a shared height and ordered columns
 * with a shared width. No individual row or column stretches its videos.
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

const safeAspectRatio = (item: VideoLayoutInput) => {
  const ratio = item.width / item.height;
  return item.width > 0 && item.height > 0 && ratio > 0 && Number.isFinite(ratio)
    ? ratio
    : 16 / 9;
};

const safeScale = (item: VideoLayoutInput) => {
  const scale = item.scale ?? 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const naturalTiles = (items: VideoLayoutInput[], columns = false) =>
  items.map((item) => ({
    id: item.id,
    width:
      (columns ? 1 / safeAspectRatio(item) : safeAspectRatio(item)) *
      safeScale(item),
    height: safeScale(item),
  }));

/**
 * At a given size, find ordered row breaks with the smallest total height.
 * Equal-height alternatives prefer balanced row widths. Unlike greedy wrapping
 * with mixed user scales, this fit test stays monotonic as the size increases.
 */
const partitionRows = (
  tiles: VideoLayoutTile[],
  width: number,
  unit: number,
  gap: number,
) => {
  const heights = new Float64Array(tiles.length + 1).fill(Infinity);
  const waste = new Float64Array(tiles.length + 1).fill(Infinity);
  const previous = new Int32Array(tiles.length + 1);
  heights[0] = waste[0] = 0;

  for (let end = 1; end <= tiles.length; end++) {
    let rowWidth = 0;
    let rowHeight = 0;
    for (let start = end - 1; start >= 0; start--) {
      rowWidth += tiles[start].width * unit + (start < end - 1 ? gap : 0);
      if (rowWidth > width) break;
      rowHeight = Math.max(rowHeight, tiles[start].height * unit);
      const height = heights[start] + rowHeight + (start > 0 ? gap : 0);
      const unusedWidth = waste[start] + (1 - rowWidth / width) ** 2;
      if (
        height < heights[end] ||
        (height === heights[end] && unusedWidth < waste[end])
      ) {
        heights[end] = height;
        waste[end] = unusedWidth;
        previous[end] = start;
      }
    }
  }

  const ranges: { start: number; end: number }[] = [];
  if (Number.isFinite(heights[tiles.length])) {
    for (let end = tiles.length; end > 0; ) {
      const start = previous[end];
      ranges.push({ start, end });
      end = start;
    }
    ranges.reverse();
  }
  return { height: heights[tiles.length], ranges };
};

const fitFullscreen = (
  items: VideoLayoutInput[],
  width: number,
  height: number,
  gap: number,
  columns: boolean,
) => {
  const tiles = naturalTiles(items, columns);
  const rowWidth = columns ? height : width;
  const availableHeight = columns ? width : height;
  let low = 0;
  let high = Math.min(
    ...tiles.map((tile) =>
      Math.min(rowWidth / tile.width, availableHeight / tile.height),
    ),
  );

  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (low + high) / 2;
    if (partitionRows(tiles, rowWidth, middle, gap).height <= availableHeight) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const partition = partitionRows(tiles, rowWidth, low, gap);
  const positioned: VideoLayoutTile[] = [];
  let y = (availableHeight - partition.height) / 2;
  for (const { start, end } of partition.ranges) {
    const row = tiles.slice(start, end).map((tile) => ({
      ...tile,
      width: tile.width * low,
      height: tile.height * low,
    }));
    const usedWidth =
      row.reduce((sum, tile) => sum + tile.width, 0) +
      gap * (row.length - 1);
    const rowHeight = Math.max(...row.map((tile) => tile.height));
    let x = (rowWidth - usedWidth) / 2;
    for (const tile of row) {
      const tileY = y + (rowHeight - tile.height) / 2;
      positioned.push({
        id: tile.id,
        width: columns ? tile.height : tile.width,
        height: columns ? tile.width : tile.height,
        x: columns ? tileY : x,
        y: columns ? x : tileY,
      });
      x += tile.width + gap;
    }
    y += rowHeight + gap;
  }
  return {
    tiles: positioned,
    area: positioned.reduce((sum, tile) => sum + tile.width * tile.height, 0),
  };
};

const computeEditorLayout = (
  items: VideoLayoutInput[],
  width: number,
  options: VideoLayoutOptions,
): VideoLayoutRow[] => {
  const gap = 6;
  const tiles = naturalTiles(items);
  const defaultUnit = Math.min(
    420,
    Math.max(210, width / (Math.ceil(Math.sqrt(items.length)) * 1.65)),
  );
  const maximumUnit = Math.min(...tiles.map((tile) => width / tile.width));
  const minimumTileWidth = Math.min(
    width,
    Math.max(0, options.minimumTileWidth ?? 0),
  );
  const minimumUnit = Math.max(
    ...tiles.map((tile) => minimumTileWidth / tile.width),
  );
  const unit = Math.min(maximumUnit, Math.max(defaultUnit, minimumUnit));
  const rows: VideoLayoutRow[] = [];

  // Editor cards include controls, so they keep horizontal reading order.
  for (const natural of tiles) {
    const tile = {
      ...natural,
      width: natural.width * unit,
      height: natural.height * unit,
    };
    const row = rows.at(-1);
    if (row && row.width + gap + tile.width <= width) {
      row.tiles.push(tile);
      row.width += gap + tile.width;
      row.height = Math.max(row.height, tile.height);
    } else {
      rows.push({
        id: `row-${tile.id}`,
        width: tile.width,
        height: tile.height,
        tiles: [tile],
      });
    }
  }
  return rows;
};

export const computeVideoLayout = (
  items: VideoLayoutInput[],
  containerWidth: number,
  containerHeight: number,
  fullscreen: boolean,
  options: VideoLayoutOptions = {},
): VideoLayoutRow[] => {
  if (!items.length) return [];
  const width = Number.isFinite(containerWidth)
    ? Math.max(1, containerWidth)
    : 1;
  const height = Number.isFinite(containerHeight)
    ? Math.max(1, containerHeight)
    : 1;
  if (!fullscreen) return computeEditorLayout(items, width, options);

  // Keep enough room for every tile even in tiny viewports or very large walls.
  const gap = Math.min(4, width / (2 * items.length), height / (2 * items.length));
  const rows = fitFullscreen(items, width, height, gap, false);
  const columns = fitFullscreen(items, width, height, gap, true);
  const best = columns.area > rows.area + 1e-6 ? columns : rows;
  return [
    {
      id: `canvas-${items.map((item) => item.id).join("-")}`,
      width,
      height,
      positioned: true,
      tiles: best.tiles,
    },
  ];
};
