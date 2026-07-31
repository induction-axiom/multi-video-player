"use client";

import {
  ChangeEvent,
  DragEvent,
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

type VideoScale = 0.5 | 1 | 2;

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

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "00:00";
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

export default function Home() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [isDragging, setIsDragging] = useState(false);
  const [isBalancing, setIsBalancing] = useState(false);
  const [balanceProgress, setBalanceProgress] = useState("");
  const [isGridFullscreen, setIsGridFullscreen] = useState(false);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
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
    currentTimeRef.current = currentTime;
  }, [currentTime]);

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
      setCurrentTime(nextTime);
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
        scale: 1 as VideoScale,
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
    if (!isGridFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      void togglePlayback();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isGridFullscreen, togglePlayback]);

  const seek = (time: number) => {
    const nextTime = Math.max(0, Math.min(time, maxDuration));
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    clockStartRef.current = performance.now() - nextTime * 1000;
    syncVideos(nextTime, true);
  };

  const updateItem = (id: string, patch: Partial<VideoItem>) => {
    setItems((existing) =>
      existing.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
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
    setCurrentTime(0);
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
            <span aria-hidden>{isPlaying ? "Ⅱ" : "▶"}</span>
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
            ＋ Add videos
          </button>
          <button
            className="secondary-button"
            onClick={balanceAudio}
            disabled={!items.length || isBalancing}
          >
            ◫ {isBalancing ? "Analyzing…" : "Balance audio"}
          </button>
        </div>

        <div className="timeline-block">
          <div className="time-readout">
            <span>{formatTime(currentTime)}</span>
            <span className="time-divider">/</span>
            <span>{formatTime(maxDuration)}</span>
          </div>
          <input
            aria-label="Master timeline"
            className="timeline"
            type="range"
            min="0"
            max={Math.max(0.01, maxDuration)}
            step="0.05"
            value={Math.min(currentTime, maxDuration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!items.length}
          />
        </div>

        <div className="master-controls">
          <label className="master-volume">
            <span aria-hidden>{masterVolume === 0 ? "×" : "◖"}</span>
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
            ⛶
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
            <span>▶</span>
            <span>▶</span>
            <span>▶</span>
          </div>
          <h2>Drop videos here</h2>
          <p>
            Choose several files and play them together. MP4, MOV, WebM, and
            other browser-supported formats work here.
          </p>
          <button className="primary-button">Choose video files</button>
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
                className="video-row"
                key={row.id}
                style={{ minHeight: row.height }}
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
                      style={{ width: tile.width }}
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
                          ×
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
                            onClick={() =>
                              updateItem(item.id, {
                                scale: Math.max(
                                  0.5,
                                  item.scale / 2,
                                ) as VideoScale,
                              })
                            }
                            disabled={item.scale === 0.5}
                            aria-label={`Shrink ${item.name}`}
                            title="Shrink width and height by half"
                          >
                            −
                          </button>
                          <strong>{item.scale}×</strong>
                          <button
                            onClick={() =>
                              updateItem(item.id, {
                                scale: Math.min(
                                  2,
                                  item.scale * 2,
                                ) as VideoScale,
                              })
                            }
                            disabled={item.scale === 2}
                            aria-label={`Enlarge ${item.name}`}
                            title="Double width and height"
                          >
                            ＋
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
                            {item.muted ? "×" : "◖"}
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
              <span>＋</span>
              Add more videos
            </button>
          </section>
        </>
      )}

      <footer>
        <span>Multi Video Player</span>
        <p>Selected files and settings are cleared when this page closes.</p>
      </footer>
    </main>
  );
}
