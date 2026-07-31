export type VideoSyncPolicy = Readonly<{
  toleratedDriftSeconds: number;
  seekThresholdSeconds: number;
  correctionRate: number;
}>;

export type VideoSyncDecision =
  | { type: "set-playback-rate"; playbackRate: number }
  | { type: "seek"; mediaTime: number };

export const DEFAULT_VIDEO_SYNC_POLICY: VideoSyncPolicy = {
  toleratedDriftSeconds: 0.08,
  seekThresholdSeconds: 0.5,
  correctionRate: 0.02,
};

const positiveModulo = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

export const mediaTimeAtTimeline = (timelineTime: number, duration: number) => {
  if (!Number.isFinite(timelineTime) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return positiveModulo(timelineTime, duration);
};

const shortestLoopedDrift = (
  targetTime: number,
  mediaTime: number,
  duration: number,
) => {
  const directDrift = targetTime - mediaTime;
  if (Math.abs(directDrift) <= duration / 2) return directDrift;
  return directDrift > 0
    ? directDrift - duration
    : directDrift + duration;
};

/**
 * Chooses a low-cost drift correction for a looping media element.
 * Small drift is ignored, moderate drift is recovered gradually, and large
 * drift seeks to the timeline position. Loop boundaries use circular distance.
 */
export const planVideoSynchronization = (
  timelineTime: number,
  mediaTime: number,
  duration: number,
  policy: VideoSyncPolicy = DEFAULT_VIDEO_SYNC_POLICY,
): VideoSyncDecision => {
  const targetTime = mediaTimeAtTimeline(timelineTime, duration);
  if (!Number.isFinite(mediaTime) || !Number.isFinite(duration) || duration <= 0) {
    return { type: "set-playback-rate", playbackRate: 1 };
  }

  const drift = shortestLoopedDrift(targetTime, mediaTime, duration);
  const absoluteDrift = Math.abs(drift);
  if (absoluteDrift <= policy.toleratedDriftSeconds) {
    return { type: "set-playback-rate", playbackRate: 1 };
  }
  if (absoluteDrift >= policy.seekThresholdSeconds) {
    return { type: "seek", mediaTime: targetTime };
  }

  return {
    type: "set-playback-rate",
    playbackRate: 1 + Math.sign(drift) * policy.correctionRate,
  };
};
