"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type AudioHTMLAttributes,
  type CSSProperties,
} from "react";
import { LoaderCircle, MoreHorizontal, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { registerAudioPlayback } from "./audio-playback-coordinator";

type NativeAudioProps = Omit<
  AudioHTMLAttributes<HTMLAudioElement>,
  "src" | "controls" | "children" | "className" | "aria-label" | "muted" | "autoPlay"
>;

export type AudioPlayerProps = NativeAudioProps & {
  src: string;
  label: string;
  compact?: boolean;
  /** Keep the primary row to play, seek and options; mute remains in options. */
  compactControls?: boolean;
  /** Class applied to the whole player, not the underlying audio element. */
  className?: string;
  /** Parents with their own error UI/token lifecycle can hide duplicate copy. */
  statusDisplay?: "inline" | "none";
  waitingLabel?: string;
  errorLabel?: string;
  retryLabel?: string;
};

type PlayerStatus = "idle" | "waiting" | "ready" | "error";
const playbackSpeeds = [0.75, 1, 1.25, 1.5, 2];

function validDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clock(value: number): string {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

const AudioPlayerMedia = forwardRef<HTMLAudioElement, AudioPlayerProps>(
  function AudioPlayerMedia({
    src, label, compact = false, compactControls = false, className = "", preload = "none",
    statusDisplay = "inline", waitingLabel = "正在准备试听…",
    errorLabel = "试听暂不可用，请重试。", retryLabel,
    onPlay, onWaiting, onCanPlay, onPlaying, onPause, onEnded,
    onTimeUpdate, onLoadedMetadata, onDurationChange, onError, onVolumeChange, onRateChange,
    ...nativeProps
  }, forwardedRef) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const optionsButtonRef = useRef<HTMLButtonElement | null>(null);
    const optionsId = useId();
    const alive = useRef(true);
    const playSequence = useRef(0);
    const [status, setStatus] = useState<PlayerStatus>("idle");
    const [playing, setPlaying] = useState(false);
    const [playRequested, setPlayRequested] = useState(false);
    const [metadataReady, setMetadataReady] = useState(false);
    const [duration, setDuration] = useState(0);
    const [position, setPosition] = useState(0);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [optionsOpen, setOptionsOpen] = useState(false);

    const setAudioElement = useCallback((audio: HTMLAudioElement | null) => {
      audioRef.current = audio;
      if (typeof forwardedRef === "function") forwardedRef(audio);
      else if (forwardedRef) forwardedRef.current = audio;
    }, [forwardedRef]);

    useEffect(() => {
      alive.current = true;
      const audio = audioRef.current;
      if (!audio) return;
      // React StrictMode may run effect cleanup/setup against the same element.
      if (audio.getAttribute("src") !== src) audio.src = src;
      const unregister = registerAudioPlayback(audio);
      return () => {
        alive.current = false;
        playSequence.current += 1;
        unregister();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
    }, [src]);

    function current(audio: HTMLAudioElement): boolean {
      return alive.current && audioRef.current === audio;
    }

    function updatePosition(audio: HTMLAudioElement) {
      if (!current(audio)) return;
      setPosition(Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0);
    }

    function updateDuration(audio: HTMLAudioElement) {
      if (current(audio)) setDuration(validDuration(audio.duration));
    }

    function start(reload = false) {
      const audio = audioRef.current;
      if (!audio) return;
      const sequence = ++playSequence.current;
      setPlayRequested(true);
      setStatus("waiting");
      if (reload) {
        setMetadataReady(false);
        setDuration(0);
        setPosition(0);
        audio.load();
      }
      void audio.play().catch((error: unknown) => {
        if (!current(audio) || sequence !== playSequence.current) return;
        setPlayRequested(false);
        setPlaying(false);
        setStatus(error instanceof DOMException && error.name === "AbortError" ? "idle" : "error");
      });
    }

    function pause() {
      playSequence.current += 1;
      audioRef.current?.pause();
      setPlayRequested(false);
      setPlaying(false);
      setStatus(value => value === "error" ? "error" : "idle");
    }

    function toggleMute() {
      const audio = audioRef.current;
      if (!audio) return;
      audio.muted = !audio.muted;
      setMuted(audio.muted);
    }

    const canSeek = metadataReady && duration > 0;
    const visiblePosition = duration > 0 ? Math.min(position, duration) : position;
    const pauseAvailable = playing || playRequested;
    const focusClass = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";
    const iconButtonClass = `inline-flex shrink-0 items-center justify-center text-studio-text transition hover:bg-sky-300/15 disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`;

    return <div className={`studio-audio-player w-full min-w-0 space-y-1.5 ${className}`}
      onKeyDown={event => {
        if (event.key !== "Escape" || !optionsOpen) return;
        setOptionsOpen(false);
        optionsButtonRef.current?.focus();
        event.stopPropagation();
      }}>
      <audio {...nativeProps} ref={setAudioElement} src={src} preload={preload}
        aria-label={label} className="sr-only" tabIndex={-1} muted={muted}
        onPlay={event => {
          const audio = event.currentTarget;
          if (current(audio)) {
            setPlaying(true);
            setPlayRequested(false);
            setStatus(audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? "waiting" : "ready");
          }
          onPlay?.(event);
        }}
        onWaiting={event => {
          if (current(event.currentTarget)) setStatus("waiting");
          onWaiting?.(event);
        }}
        onCanPlay={event => {
          if (current(event.currentTarget)) setStatus("ready");
          onCanPlay?.(event);
        }}
        onPlaying={event => {
          if (current(event.currentTarget)) {
            setStatus("ready"); setPlaying(true); setPlayRequested(false);
          }
          onPlaying?.(event);
        }}
        onPause={event => {
          if (current(event.currentTarget)) {
            playSequence.current += 1;
            setPlaying(false); setPlayRequested(false);
            setStatus(value => value === "error" ? "error" : "idle");
          }
          onPause?.(event);
        }}
        onEnded={event => {
          if (current(event.currentTarget)) {
            playSequence.current += 1;
            setPlaying(false); setPlayRequested(false); setStatus("idle");
            updatePosition(event.currentTarget);
          }
          onEnded?.(event);
        }}
        onTimeUpdate={event => {
          updatePosition(event.currentTarget);
          onTimeUpdate?.(event);
        }}
        onLoadedMetadata={event => {
          if (current(event.currentTarget)) setMetadataReady(true);
          updateDuration(event.currentTarget); updatePosition(event.currentTarget);
          onLoadedMetadata?.(event);
        }}
        onDurationChange={event => {
          updateDuration(event.currentTarget);
          onDurationChange?.(event);
        }}
        onError={event => {
          if (current(event.currentTarget)) {
            playSequence.current += 1;
            setPlaying(false); setPlayRequested(false); setStatus("error");
          }
          onError?.(event);
        }}
        onVolumeChange={event => {
          if (current(event.currentTarget)) {
            setMuted(event.currentTarget.muted);
            setVolume(event.currentTarget.volume);
          }
          onVolumeChange?.(event);
        }}
        onRateChange={event => {
          if (current(event.currentTarget) && Number.isFinite(event.currentTarget.playbackRate)) {
            setPlaybackRate(event.currentTarget.playbackRate);
          }
          onRateChange?.(event);
        }}
      />
      <div role="group" aria-label={`${label}播放控制`} aria-busy={status === "waiting"}
        className={`grid min-w-0 ${compactControls ? "grid-cols-[2.25rem_minmax(0,1fr)_1.5rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_2rem_1.5rem]"} items-center gap-x-2 border border-studio-line bg-black/20 ${compact ? "rounded-lg p-1.5" : "rounded-xl p-2"}`}>
        <button type="button" aria-label={`${pauseAvailable ? "暂停" : "播放"}${label}`}
          disabled={!src} onClick={() => pauseAvailable ? pause() : start(status === "error")}
          className={`${iconButtonClass} row-span-2 h-9 w-9 rounded-full border border-sky-300/25 bg-sky-300/10 text-sky-100`}>
          {status === "waiting" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            : pauseAvailable ? <Pause aria-hidden="true" className="h-4 w-4" />
              : <Play aria-hidden="true" className="h-4 w-4 translate-x-px" />}
        </button>
        <input type="range" min={0} max={duration || 1} step={0.01}
          value={Math.min(visiblePosition, duration || 1)} disabled={!canSeek}
          aria-label={`${label}播放进度`}
          aria-valuetext={`${clock(visiblePosition)} / ${duration > 0 ? clock(duration) : "未知时长"}`}
          style={{ "--audio-progress": `${canSeek ? visiblePosition / duration * 100 : 0}%` } as CSSProperties}
          onChange={event => {
            const audio = audioRef.current;
            const next = event.currentTarget.valueAsNumber;
            if (!audio || !canSeek || !Number.isFinite(next)) return;
            audio.currentTime = Math.max(0, Math.min(duration, next));
            updatePosition(audio);
          }}
          className={`studio-audio-seek col-start-2 row-start-1 h-5 w-full min-w-0 cursor-pointer accent-sky-300 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-40 ${focusClass}`} />
        {!compactControls && <button type="button" aria-label={`${muted ? "取消静音" : "静音"}${label}`} aria-pressed={muted}
          onClick={toggleMute}
          className={`${iconButtonClass} col-start-3 row-span-2 row-start-1 h-8 w-8 rounded-lg`}>
          {muted ? <VolumeX aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
        </button>}
        <span aria-hidden="true" className="col-start-2 row-start-2 min-w-0 truncate text-center text-[10px] leading-4 tabular-nums text-studio-muted">
          {clock(visiblePosition)} / {duration > 0 ? clock(duration) : "--:--"}
        </span>
        <button type="button" ref={optionsButtonRef} aria-label={`${label}更多播放选项`} title="更多播放选项"
          aria-expanded={optionsOpen} aria-controls={optionsId} onClick={() => setOptionsOpen(value => !value)}
          className={`${iconButtonClass} ${compactControls ? "col-start-3" : "col-start-4"} row-span-2 row-start-1 h-8 w-6 rounded-md`}>
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div id={optionsId} hidden={!optionsOpen}
        className={`${optionsOpen ? "grid" : "hidden"} min-w-0 gap-3 rounded-xl border border-studio-line bg-black/20 p-3 text-xs`}>
            {compactControls && <button type="button" aria-label={`${muted ? "取消静音" : "静音"}${label}`} aria-pressed={muted}
              onClick={toggleMute} className={`${iconButtonClass} min-h-8 justify-start gap-2 rounded-md px-2`}>
              {muted ? <VolumeX aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
              <span>{muted ? "取消静音" : "静音"}</span>
            </button>}
            <a href={src} download aria-label={`下载${label}`}
              className={`flex min-h-8 items-center rounded-md px-2 text-studio-text hover:bg-white/[0.06] ${focusClass}`}>下载音频</a>
            <label className="grid min-w-0 gap-1 text-studio-muted">
              <span>音量 · {Math.round(volume * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={volume}
                aria-label={`${label}音量`} aria-valuetext={`${Math.round(volume * 100)}%`}
                onChange={event => {
                  const audio = audioRef.current;
                  const next = event.currentTarget.valueAsNumber;
                  if (!audio || !Number.isFinite(next)) return;
                  audio.volume = Math.max(0, Math.min(1, next));
                  setVolume(audio.volume);
                }}
                className={`studio-audio-seek h-5 w-full min-w-0 cursor-pointer accent-sky-300 [color-scheme:dark] ${focusClass}`}
                style={{ "--audio-progress": `${volume * 100}%` } as CSSProperties} />
            </label>
            <label className="flex min-w-0 items-center justify-between gap-2 text-studio-muted">
              <span>播放速度</span>
              <select aria-label={`${label}播放速度`} value={playbackRate}
                onChange={event => {
                  const audio = audioRef.current;
                  const next = Number(event.currentTarget.value);
                  if (!audio || !playbackSpeeds.includes(next)) return;
                  audio.playbackRate = next;
                  setPlaybackRate(audio.playbackRate);
                }}
                className={`min-h-8 min-w-0 rounded-md border border-studio-line bg-studio-bg px-2 text-studio-text [color-scheme:dark] ${focusClass}`}>
                {!playbackSpeeds.includes(playbackRate) ? <option value={playbackRate}>{playbackRate}×</option> : null}
                {playbackSpeeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
              </select>
            </label>
      </div>
      {statusDisplay === "inline" && status === "waiting"
        ? <p role="status" className="text-xs leading-5 text-studio-muted">{waitingLabel}</p> : null}
      {statusDisplay === "inline" && status === "error" ? <div className="space-y-1.5">
        <p role="alert" className="break-words text-xs leading-5 text-amber-100">{errorLabel}</p>
        <button type="button" aria-label={retryLabel ?? `重试${label}`}
          onClick={() => start(true)}
          className={`min-h-9 rounded-lg border border-studio-line px-3 py-1.5 text-xs font-semibold text-studio-muted transition hover:bg-white/[0.06] ${focusClass}`}>重试试听</button>
      </div> : null}
    </div>;
  },
);

/** Changing src replaces the element, preventing old-source events/promise races. */
export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(
  function AudioPlayer(props, ref) {
    return <AudioPlayerMedia key={props.src} {...props} ref={ref} />;
  },
);
