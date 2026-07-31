"use client";

import {
  ChangeEvent,
  DragEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { computeVideoLayout } from "../algorithm/video-layout";

type Loudness = {
  rmsDb: number;
  peakDb: number;
  gainDb: number;
};

type VideoScale = number;

type VideoItem = {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  scale: VideoScale;
  loudness?: Loudness;
};

type ResizeNotice = {
  message: string;
};

const MINIMUM_TILE_WIDTH = 180;
const VIDEO_LAYOUT_OPTIONS = { minimumTileWidth: MINIMUM_TILE_WIDTH };
const TILE_RESIZE_EPSILON = 0.5;
const TIMELINE_REFRESH_INTERVAL_MS = 1000 / 30;

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "00:00";
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const formatScale = (scale: number) =>
  Number.parseFloat(scale.toPrecision(6)).toString();

const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

const IconFrame = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => (
  <svg
    aria-hidden="true"
    className={`ui-icon ${className}`.trim()}
    viewBox="0 0 24 24"
    fill="none"
  >
    {children}
  </svg>
);

const PlayIcon = () => (
  <IconFrame>
    <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />
  </IconFrame>
);

const PauseIcon = () => (
  <IconFrame>
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none" />
  </IconFrame>
);

const PlusIcon = () => (
  <IconFrame>
    <path d="M12 5v14M5 12h14" />
  </IconFrame>
);

const MinusIcon = () => (
  <IconFrame>
    <path d="M5 12h14" />
  </IconFrame>
);

const VideoPlusIcon = () => (
  <IconFrame>
    <rect x="3.5" y="6" width="12.5" height="12" rx="2" />
    <path d="m16 10 4.5-2.5v9L16 14M9.75 9v6M6.75 12h6" />
  </IconFrame>
);

const EqualizerIcon = () => (
  <IconFrame>
    <path d="M4 6h5M15 6h5M4 12h9M17 12h3M4 18h2M10 18h10" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  </IconFrame>
);

const ExpandIcon = () => (
  <IconFrame>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </IconFrame>
);

const CollapseIcon = () => (
  <IconFrame>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </IconFrame>
);

const CloseIcon = () => (
  <IconFrame>
    <path d="m7 7 10 10M17 7 7 17" />
  </IconFrame>
);

const VolumeIcon = ({
  muted,
  level = 1,
}: {
  muted: boolean;
  level?: number;
}) => (
  <IconFrame className="volume-icon">
    <path
      d="M11 5 6.75 8.5H4v7h2.75L11 19V5Z"
      fill="currentColor"
    />
    {muted ? (
      <>
        <path d="m15.5 9.5 4 5" />
        <path d="m19.5 9.5-4 5" />
      </>
    ) : (
      <>
        {level > 0 && <path d="M14.5 9.25a4 4 0 0 1 0 5.5" />}
        {level > 0.5 && <path d="M17.5 6.75a7.5 7.5 0 0 1 0 10.5" />}
      </>
    )}
  </IconFrame>
);

type PlaybackTimelineProps = {
  currentTimeRef: RefObject<number>;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
};

/**
 * Projects the high-frequency playback clock into a small, isolated UI subtree.
 * Native video rendering remains independent from this display refresh rate.
 */
const PlaybackTimeline = ({
  currentTimeRef,
  duration,
  isPlaying,
  onSeek,
}: PlaybackTimelineProps) => {
  const [displayTime, setDisplayTime] = useState(0);

  useEffect(() => {
    setDisplayTime(Math.min(currentTimeRef.current, duration));
    if (!isPlaying) return;

    let frame = 0;
    let lastRefresh = 0;
    const refresh = (now: number) => {
      if (now - lastRefresh >= TIMELINE_REFRESH_INTERVAL_MS) {
        setDisplayTime(Math.min(currentTimeRef.current, duration));
        lastRefresh = now;
      }
      frame = requestAnimationFrame(refresh);
    };

    frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, [currentTimeRef, duration, isPlaying]);

  const seek = (time: number) => {
    setDisplayTime(time);
    onSeek(time);
  };

  return (
    <div className="timeline-block">
      <div className="time-readout">
        <span>{formatTime(displayTime)}</span>
        <span className="time-divider">/</span>
        <span>{formatTime(duration)}</span>
      </div>
      <input
        aria-label="Master timeline"
        className="timeline"
        type="range"
        min="0"
        max={Math.max(0.01, duration)}
        step="0.05"
        value={Math.min(displayTime, duration || 0)}
        onChange={(event) => seek(Number(event.target.value))}
        disabled={duration <= 0}
      />
    </div>
  );
};

export default function Home() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [isDragging, setIsDragging] = useState(false);
  const [isBalancing, setIsBalancing] = useState(false);
  const [balanceProgress, setBalanceProgress] = useState("");
  const [isGridFullscreen, setIsGridFullscreen] = useState(false);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [resizeNotice, setResizeNotice] = useState<ResizeNotice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const objectUrlsRef = useRef(new Set<string>());
  const clockStartRef = useRef(0);
  const currentTimeRef = useRef(0);

  const maxDuration = useMemo(
    () => Math.max(0, ...items.map((item) => item.duration)),
    [items],
  );
  const soloActive = items.some((item) => item.solo);
  const layoutRows = useMemo(
    () =>
      computeVideoLayout(
        items,
        gridSize.width || 1200,
        gridSize.height || 800,
        isGridFullscreen,
        VIDEO_LAYOUT_OPTIONS,
      ),
    [gridSize.height, gridSize.width, isGridFullscreen, items],
  );
  const layoutStructure = useMemo(
    () => layoutRows.map((row) => row.id).join("|"),
    [layoutRows],
  );
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const syncVideos = useCallback(
    (time: number, force = false) => {
      for (const item of items) {
        const video = videoRefs.current.get(item.id);
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) continue;
        const expected = time % video.duration;
        if (force || Math.abs(video.currentTime - expected) > 0.24) {
          video.currentTime = expected;
        }
      }
    },
    [items],
  );

  useEffect(() => {
    if (!resizeNotice) return;
    const timeout = window.setTimeout(() => setResizeNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [resizeNotice]);

  useEffect(() => {
    for (const item of items) {
      const video = videoRefs.current.get(item.id);
      if (!video) continue;
      video.volume = Math.min(1, item.volume * masterVolume);
      video.muted = item.muted || (soloActive && !item.solo);
    }
  }, [items, layoutStructure, masterVolume, soloActive]);

  useEffect(() => {
    if (!isPlaying) return;

    const time = currentTimeRef.current;
    for (const video of videoRefs.current.values()) {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const expected = time % video.duration;
        if (Math.abs(video.currentTime - expected) > 0.24) {
          video.currentTime = expected;
        }
      }
      void video.play().catch(() => {
        // A later user playback action can recover if the browser blocks play().
      });
    }
  }, [isPlaying, layoutStructure]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateSize = () => {
      const rect = grid.getBoundingClientRect();
      const styles = window.getComputedStyle(grid);
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const verticalPadding =
        Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      setGridSize({
        width: Math.max(1, rect.width - horizontalPadding),
        height: Math.max(1, rect.height - verticalPadding),
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(grid);
    updateSize();
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsGridFullscreen(document.fullscreenElement === gridRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isPlaying || maxDuration <= 0) return;
    let frame = 0;
    let lastSync = 0;

    const tick = (now: number) => {
      let nextTime = (now - clockStartRef.current) / 1000;
      if (nextTime >= maxDuration) {
        nextTime %= maxDuration;
        clockStartRef.current = now - nextTime * 1000;
        syncVideos(nextTime, true);
      } else if (now - lastSync > 1000) {
        syncVideos(nextTime);
        lastSync = now;
      }
      currentTimeRef.current = nextTime;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, maxDuration, syncVideos]);

  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const registerVideo = useCallback((id: string, node: HTMLVideoElement | null) => {
    if (node) videoRefs.current.set(id, node);
    else videoRefs.current.delete(id);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith("video/"));
    if (!videos.length) return;
    const newItems = videos.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        url,
        name: file.name.replace(/\.[^.]+$/, ""),
        duration: 0,
        width: 16,
        height: 9,
        volume: 1,
        muted: false,
        solo: false,
        scale: 1,
      };
    });
    setItems((existing) => [
      ...existing,
      ...newItems,
    ]);
  }, []);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const togglePlayback = useCallback(async () => {
    if (!items.length) {
      fileInputRef.current?.click();
      return;
    }

    if (isPlaying) {
      for (const video of videoRefs.current.values()) video.pause();
      setIsPlaying(false);
      return;
    }

    syncVideos(currentTimeRef.current, true);
    clockStartRef.current = performance.now() - currentTimeRef.current * 1000;
    await Promise.allSettled(
      Array.from(videoRefs.current.values()).map((video) => video.play()),
    );
    setIsPlaying(true);
  }, [isPlaying, items.length, syncVideos]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isInteractive =
        target instanceof HTMLElement &&
        Boolean(target.closest("button, input, select, textarea"));
      if (event.code !== "Space" || event.repeat || isInteractive) return;

      event.preventDefault();
      void togglePlayback();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback]);

  const seek = (time: number) => {
    const nextTime = Math.max(0, Math.min(time, maxDuration));
    currentTimeRef.current = nextTime;
    clockStartRef.current = performance.now() - nextTime * 1000;
    syncVideos(nextTime, true);
  };

  const updateItem = (id: string, patch: Partial<VideoItem>) => {
    setItems((existing) =>
      existing.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const resizeItem = (id: string, factor: 0.5 | 2) => {
    const currentTile = layoutRows
      .flatMap((row) => row.tiles)
      .find((tile) => tile.id === id);
    const item = itemMap.get(id);
    if (!currentTile || !item) return;

    const nextScale = item.scale * factor;
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      setResizeNotice({ message: "The resize limit has been reached." });
      return;
    }

    const nextItems = items.map((candidate) =>
      candidate.id === id ? { ...candidate, scale: nextScale } : candidate,
    );
    const nextRows = computeVideoLayout(
      nextItems,
      gridSize.width || 1200,
      gridSize.height || 800,
      isGridFullscreen,
      VIDEO_LAYOUT_OPTIONS,
    );
    const nextTile = nextRows
      .flatMap((row) => row.tiles)
      .find((tile) => tile.id === id);
    if (!nextTile) return;

    const changesInRequestedDirection =
      factor < 1
        ? nextTile.width < currentTile.width - TILE_RESIZE_EPSILON
        : nextTile.width > currentTile.width + TILE_RESIZE_EPSILON;
    if (changesInRequestedDirection) {
      setResizeNotice(null);
      setItems(nextItems);
      return;
    }

    setResizeNotice({
      message:
        factor < 1
          ? `Minimum size reached — cards stay at least ${MINIMUM_TILE_WIDTH}px wide so the controls remain usable.`
          : "Maximum size reached — this video cannot grow past the available layout width.",
    });
  };

  const removeItem = (id: string) => {
    setItems((existing) => {
      const removed = existing.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.url);
        objectUrlsRef.current.delete(removed.url);
      }
      return existing.filter((item) => item.id !== id);
    });
  };

  const clearAll = () => {
    for (const video of videoRefs.current.values()) video.pause();
    for (const item of items) {
      URL.revokeObjectURL(item.url);
      objectUrlsRef.current.delete(item.url);
    }
    videoRefs.current.clear();
    setItems([]);
    currentTimeRef.current = 0;
    setIsPlaying(false);
  };

  const balanceAudio = async () => {
    if (!items.length || isBalancing) return;
    setIsBalancing(true);
    setBalanceProgress("Preparing audio analysis…");
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioContextClass();
    const results: Array<{ id: string; rmsDb: number; peakDb: number }> = [];

    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        setBalanceProgress(
          `Analyzing ${index + 1}/${items.length} · ${item.name}`,
        );
        try {
          const buffer = await context.decodeAudioData(await item.file.arrayBuffer());
          let squareSum = 0;
          let peak = 0;
          let sampleCount = 0;
          const stride = Math.max(1, Math.floor(buffer.sampleRate / 6000));

          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let sample = 0; sample < data.length; sample += stride) {
              const amplitude = Math.abs(data[sample]);
              squareSum += amplitude * amplitude;
              peak = Math.max(peak, amplitude);
              sampleCount++;
            }
          }

          results.push({
            id: item.id,
            rmsDb: db(Math.sqrt(squareSum / Math.max(1, sampleCount))),
            peakDb: db(peak),
          });
        } catch {
          // Unsupported audio codecs stay at their existing manual volume.
        }
      }

      if (results.length) {
        const sorted = results.map((result) => result.rmsDb).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const resultMap = new Map(
          results.map((result) => {
            const gainDb = Math.max(
              -18,
              Math.min(0, median - result.rmsDb, -1 - result.peakDb),
            );
            return [result.id, { ...result, gainDb }];
          }),
        );

        setItems((existing) =>
          existing.map((item) => {
            const loudness = resultMap.get(item.id);
            return loudness
              ? { ...item, loudness, volume: 10 ** (loudness.gainDb / 20) }
              : item;
          }),
        );
      }
      setBalanceProgress(
        results.length === items.length
          ? "Audio balanced by average loudness and peak level"
          : `Balanced ${results.length}/${items.length} decodable audio tracks`,
      );
    } finally {
      await context.close();
      setIsBalancing(false);
    }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await gridRef.current?.requestFullscreen();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>Multi Video Player</h1>
            <p>Play local videos together</p>
          </div>
        </div>
        <div className="privacy-pill">
          <span className="privacy-dot" />
          Local files only
        </div>
      </header>

      <section className="control-deck" aria-label="Player controls">
        <div className="transport">
          <button className="primary-button" onClick={togglePlayback}>
            {isPlaying ? (
              <PauseIcon />
            ) : items.length ? (
              <PlayIcon />
            ) : (
              <VideoPlusIcon />
            )}
            {isPlaying
              ? "Pause all"
              : items.length
                ? "Play all"
                : "Choose videos"}
          </button>
          <button
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon />
            Add videos
          </button>
          <button
            className="secondary-button"
            onClick={balanceAudio}
            disabled={!items.length || isBalancing}
          >
            <EqualizerIcon />
            {isBalancing ? "Analyzing…" : "Balance audio"}
          </button>
        </div>

        <PlaybackTimeline
          currentTimeRef={currentTimeRef}
          duration={maxDuration}
          isPlaying={isPlaying}
          onSeek={seek}
        />

        <div className="master-controls">
          <label className="master-volume">
            <VolumeIcon muted={masterVolume === 0} level={masterVolume} />
            <input
              aria-label="Master volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={(event) => setMasterVolume(Number(event.target.value))}
            />
            <strong>{Math.round(masterVolume * 100)}%</strong>
          </label>
          <button
            className="icon-button"
            onClick={toggleFullscreen}
            title={isGridFullscreen ? "Exit fullscreen" : "Smart fullscreen"}
            aria-label={
              isGridFullscreen
                ? "Exit fullscreen"
                : "Open the smart layout in fullscreen"
            }
          >
            {isGridFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          <button
            className="danger-button"
            onClick={clearAll}
            disabled={!items.length}
          >
            Clear
          </button>
        </div>
      </section>

      {balanceProgress && (
        <div className={`status-line ${isBalancing ? "working" : ""}`}>
          <span />
          {balanceProgress}
        </div>
      )}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="video/*"
        multiple
        onChange={handleFiles}
      />

      {items.length === 0 ? (
        <section
          className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-visual">
            <span><PlayIcon /></span>
            <span><PlayIcon /></span>
            <span><PlayIcon /></span>
          </div>
          <h2>Drop videos here</h2>
          <p>
            Choose several files and play them together. MP4, MOV, WebM, and
            other browser-supported formats work here.
          </p>
          <button className="primary-button">
            <VideoPlusIcon />
            Choose video files
          </button>
        </section>
      ) : (
        <>
          <div className="grid-heading">
            <div>
              <span className="eyebrow">PLAYLIST</span>
              <h2>
                {items.length} {items.length === 1 ? "video" : "videos"}
              </h2>
            </div>
            <p>
              Shorter clips loop automatically · Solo isolates one audio track
            </p>
          </div>
          <section
            ref={gridRef}
            className="video-grid"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {layoutRows.map((row) => (
              <div
                className={`video-row ${row.positioned ? "is-positioned" : ""}`}
                key={row.id}
                style={
                  row.positioned
                    ? {
                        width: row.width,
                        height: row.height,
                        minHeight: row.height,
                      }
                    : { minHeight: row.height }
                }
              >
                {row.tiles.map((tile) => {
                  const item = itemMap.get(tile.id);
                  if (!item) return null;
                  const index = items.findIndex(
                    (candidate) => candidate.id === item.id,
                  );
                  return (
                    <article
                      className={`video-card ${item.solo ? "is-solo" : ""}`}
                      key={item.id}
                      style={{
                        width: tile.width,
                        left: row.positioned ? tile.x : undefined,
                        top: row.positioned ? tile.y : undefined,
                      }}
                    >
                      <div className="video-stage" style={{ height: tile.height }}>
                        <video
                          ref={(node) => registerVideo(item.id, node)}
                          src={item.url}
                          playsInline
                          preload="metadata"
                          loop
                          onLoadedMetadata={(event) =>
                            updateItem(item.id, {
                              duration: event.currentTarget.duration,
                              width: event.currentTarget.videoWidth,
                              height: event.currentTarget.videoHeight,
                            })
                          }
                        />
                        <span className="tile-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <button
                          className="remove-button"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.name}`}
                          title="Remove video"
                        >
                          <CloseIcon />
                        </button>
                        {(item.muted || (soloActive && !item.solo)) && (
                          <span className="muted-badge">Muted</span>
                        )}
                      </div>
                      <div className="card-details">
                        <div className="card-title-row">
                          <div>
                            <h3 title={item.name}>{item.name}</h3>
                            <p>
                              {item.width === item.height
                                ? "Square"
                                : item.width > item.height
                                  ? "Landscape"
                                  : "Portrait"}{" "}
                              ·{" "}
                              {formatTime(item.duration)}
                              {item.loudness
                                ? ` · Balanced ${item.loudness.gainDb.toFixed(1)} dB`
                                : ""}
                            </p>
                          </div>
                          <button
                            className={`solo-button ${item.solo ? "active" : ""}`}
                            onClick={() =>
                              updateItem(item.id, { solo: !item.solo })
                            }
                            aria-label={`${item.name} solo`}
                            title="Solo audio"
                          >
                            S
                          </button>
                        </div>
                        <div
                          className="size-controls"
                          role="group"
                          aria-label={`${item.name} display size`}
                        >
                          <span>Size</span>
                          <button
                            onClick={() => resizeItem(item.id, 0.5)}
                            aria-label={`Shrink ${item.name}`}
                            title="Halve until the tile reaches its minimum size"
                          >
                            <MinusIcon />
                          </button>
                          <strong>{formatScale(item.scale)}×</strong>
                          <button
                            onClick={() => resizeItem(item.id, 2)}
                            aria-label={`Enlarge ${item.name}`}
                            title="Double until the tile reaches its layout boundary"
                          >
                            <PlusIcon />
                          </button>
                        </div>
                        <div className="track-controls">
                          <button
                            className={`mute-button ${item.muted ? "active" : ""}`}
                            onClick={() =>
                              updateItem(item.id, { muted: !item.muted })
                            }
                            aria-label={item.muted ? "Unmute" : "Mute"}
                          >
                            <VolumeIcon
                              muted={item.muted}
                              level={item.volume}
                            />
                          </button>
                          <input
                            aria-label={`${item.name} volume`}
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={item.volume}
                            onChange={(event) =>
                              updateItem(item.id, {
                                volume: Number(event.target.value),
                                loudness: undefined,
                              })
                            }
                          />
                          <span>{Math.round(item.volume * 100)}%</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}

            <button
              className="add-card"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon />
              Add more videos
            </button>
          </section>
        </>
      )}

      <footer>
        <span>Multi Video Player</span>
        <p>Selected files and settings are cleared when this page closes.</p>
      </footer>

      {resizeNotice && (
        <div className="resize-notice" role="status" aria-live="polite">
          {resizeNotice.message}
        </div>
      )}
    </main>
  );
}
