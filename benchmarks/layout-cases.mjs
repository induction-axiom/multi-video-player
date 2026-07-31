const fromRatios = (name, ratios, width = 1920, height = 1080) => ({
  name,
  width,
  height,
  videos: ratios.map((ratio, index) => ({
    id: `${name}-${index + 1}`,
    width: Math.round(ratio * 1000),
    height: 1000,
  })),
});

const repeat = (count, ratio) => Array.from({ length: count }, () => ratio);

const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const seededRatios = (count, seed) => {
  const commonRatios = [9 / 21, 9 / 16, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 16 / 9, 21 / 9];
  const random = createRandom(seed);

  return Array.from({ length: count }, () => {
    if (random() < 0.8) {
      return commonRatios[Math.floor(random() * commonRatios.length)];
    }

    return 0.4 + random() * 2;
  });
};

export const generateLayoutCases = ({
  samples,
  videos,
  seed = 1,
  width = 1920,
  height = 1080,
}) =>
  Array.from({ length: samples }, (_, index) =>
    fromRatios(
      `generated-${videos}-${index + 1}`,
      seededRatios(videos, seed + index),
      width,
      height,
    ),
  );

export const layoutCases = [
  fromRatios("single-16x9", [16 / 9]),
  fromRatios("four-16x9", repeat(4, 16 / 9)),
  fromRatios("nine-16x9", repeat(9, 16 / 9)),
  fromRatios("mixed-five", [16 / 9, 9 / 16, 1, 21 / 9, 4 / 3]),
  fromRatios("portrait-twelve", repeat(12, 9 / 16)),
  fromRatios("random-twenty", seededRatios(20, 20)),
  fromRatios("random-fifty", seededRatios(50, 50)),
  fromRatios("random-one-hundred", seededRatios(100, 100)),
];
