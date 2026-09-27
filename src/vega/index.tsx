import React, { useCallback } from 'react';
import { AppState } from 'react-native';
import {
  AudioContentType,
  AudioPlayer,
  AudioUsageType,
  KeplerVideoSurfaceView,
  MediaSource,
  VideoPlayer as VegaVideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import type {
  AppLifecycle,
  AssetSource,
  ClipPlayer,
  MediaAdapter,
  Unsubscribe,
  VideoPlayer,
  VideoSurfaceProps,
} from '../MediaAdapter';
import { DEFAULT_WINDOW, SegmentBuffer, type AppendTarget, type BufferWindow } from './SegmentBuffer';
import { log } from '../log';

export {
  SegmentBuffer,
  DEFAULT_WINDOW,
  type AppendTarget,
  type BufferWindow,
  type SourceLike,
} from './SegmentBuffer';

/**
 * The Vega OS implementation of `MediaAdapter`.
 *
 * EXTRACTED from code that already ran on the Vega Virtual Device, not written
 * from the interface down. Each of the following is a bug somebody already
 * paid for (details in PLATFORM.md):
 *   - `srcObject`, never `src` — `url_mode_broken`: assigning a URL to `src`
 *     fails before a single byte is requested;
 *   - dual readiness tracking — `surface_races_init`: the surface can arrive
 *     before `initialize()` resolves, and playing before both have landed
 *     yields MEDIA_ERR_SRC_NOT_SUPPORTED, which reads exactly like an
 *     unsupported file and is not one;
 *   - fragmented MP4 through MediaSource only — `mse_path`;
 *   - clips on an AudioPlayer built for accessibility speech, as a second
 *     stream over the film — `concurrent_streams`.
 */

export interface VegaAdapterOptions {
  /**
   * The MSE type of YOUR asset, with full codec parameters. A bare
   * 'video/mp4' is rejected at addSourceBuffer. Default: H.264 Constrained
   * Baseline L3.0 + AAC-LC. Read yours with
   * `ffprobe -show_streams` and build the RFC 6381 string.
   */
  videoMime?: string;
  /** the MSE type of the description clips (default fragmented AAC-LC) */
  clipMime?: string;
  /** how much media to hold around the playhead */
  window?: BufferWindow;
}

const DEFAULT_VIDEO_MIME = 'video/mp4; codecs="avc1.42C01E,mp4a.40.2"';
const DEFAULT_CLIP_MIME = 'audio/mp4; codecs="mp4a.40.2"';

type Listener = () => void;

/** whole-file append, for description CLIPS — they are seconds long, not films */
function fetchAndAppend(source: MediaSource, mime: string, uri: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    source.addEventListener('sourceopen', () => {
      (async () => {
        try {
          const buffer = source.addSourceBuffer(mime);

          const response = await fetch(uri);
          const bytes = new Uint8Array(await response.arrayBuffer());

          (buffer as unknown as AppendTarget).addEventListener('updateend', () => {
            if (source.readyState !== 'open') return;
            source.endOfStream();
            resolve(bytes.byteLength);
          });

          buffer.appendBuffer(bytes);
        } catch (err) {
          reject(err as Error);
        }
      })().catch(reject);
    });
  });
}

class VegaVideo implements VideoPlayer {
  readonly player = new VegaVideoPlayer();

  private ready = { player: false, surface: false };
  private pendingPlay: (() => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private initialised: Promise<void> | null = null;
  private lastError: Error | null = null;
  private segments: SegmentBuffer | null = null;

  constructor(
    private readonly mime: string,
    private readonly window: BufferWindow,
  ) {}

  private async initialize(): Promise<void> {
    if (!this.initialised) {
      this.initialised = this.player.initialize().then(() => {
        this.player.addEventListener('error', () => {
          const code = this.player.error?.code ?? -1;
          const msg = (this.player.error as { message?: string } | null)?.message ?? 'none';
          log(`player.error code=${code} msg=${msg}`);
          this.lastError = new Error(`media error ${code}: ${msg}`);
          this.emit('error');
        });
        for (const type of ['timeupdate', 'seeked', 'waiting', 'stalled', 'playing', 'ended'] as const) {
          this.player.addEventListener(type, () => this.emit(type));
        }
      });
    }
    return this.initialised;
  }

  private emit(type: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }

  private on(type: string, cb: Listener): Unsubscribe {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(cb);
    this.listeners.set(type, set);
    return () => set.delete(cb);
  }

  /** called by the surface component when the platform hands over a handle */
  attachSurface(handle: string): void {
    log(`player.surface created handle=${handle}`);
    this.player.setSurfaceHandle(handle);
    this.ready.surface = true;
    this.release();
  }

  detachSurface(handle: string): void {
    log(`player.surface destroyed handle=${handle}`);
    this.player.clearSurfaceHandle(handle);
    this.ready.surface = false;
  }

  /** whichever of the two readiness signals lands second lets playback start */
  private release(): void {
    if (!this.ready.player || !this.ready.surface) return;
    const go = this.pendingPlay;
    this.pendingPlay = null;
    go?.();
  }

  async open(asset: AssetSource): Promise<void> {
    await this.initialize();

    const source = new MediaSource();

    const opened = new Promise<void>((resolve, reject) => {
      source.addEventListener('sourceopen', () => {
        (async () => {
          const buffer = source.addSourceBuffer(this.mime);
          this.segments = new SegmentBuffer(
            source,
            buffer as unknown as AppendTarget,
            asset,
            this.window,
          );
          await this.segments.start();
          resolve();
        })().catch(reject);
      });
    });

    // srcObject, NOT src — see PLATFORM.md `url_mode_broken`.
    this.player.srcObject = source;

    await opened;
    log(`player.opened segments=${asset.segments.length} init=${asset.initUri ? 'yes' : 'none'}`);

    // Keep the window fed as the playhead moves. The bounded window is what
    // stops a feature-length asset becoming a feature-length ArrayBuffer.
    this.on('timeupdate', () => {
      void this.segments?.ensure(this.positionMs());
    });

    this.ready.player = true;
    this.release();
  }

  play(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const start = () => {
        this.player
          .play()
          .then(() => {
            log('player.play resolved');
            resolve();
          })
          .catch(reject);
      };
      if (this.ready.player && this.ready.surface) start();
      else this.pendingPlay = start; // the surface race, handled once, here
    });
  }

  pause(): void {
    this.player.pause();
  }

  positionMs(): number {
    return Math.round(this.player.currentTime * 1000);
  }

  durationMs(): number {
    const d = this.player.duration;
    return Number.isFinite(d) ? Math.round(d * 1000) : 0;
  }

  isPlaying(): boolean {
    return !this.player.paused;
  }

  setVolumePct(pct: number): void {
    this.player.volume = Math.max(0, Math.min(100, pct)) / 100;
  }

  onPosition(cb: (ms: number) => void): Unsubscribe {
    return this.on('timeupdate', () => cb(this.positionMs()));
  }

  onSeek(cb: (ms: number) => void): Unsubscribe {
    return this.on('seeked', () => cb(this.positionMs()));
  }

  onStalled(cb: () => void): Unsubscribe {
    const offWaiting = this.on('waiting', cb);
    const offStalled = this.on('stalled', cb);
    return () => {
      offWaiting();
      offStalled();
    };
  }

  onPlaying(cb: () => void): Unsubscribe {
    return this.on('playing', cb);
  }

  onEnded(cb: () => void): Unsubscribe {
    return this.on('ended', cb);
  }

  onError(cb: (err: Error) => void): Unsubscribe {
    return this.on('error', () => cb(this.lastError ?? new Error('media error')));
  }

  async destroy(): Promise<void> {
    this.segments?.dispose();
    this.segments = null;
    this.listeners.clear();
    this.ready = { player: false, surface: false };
    this.pendingPlay = null;
    await this.player.deinitialize().catch(() => {
      // best effort during teardown; must not throw into React's cleanup path
    });
  }
}

class VegaClips implements ClipPlayer {
  private current: AudioPlayer | null = null;

  constructor(private readonly mime: string) {}

  async play(uri: string): Promise<void> {
    const player = new AudioPlayer(
      AudioContentType.CONTENT_TYPE_SPEECH,
      AudioUsageType.USAGE_ACCESSIBILITY,
    );
    this.current = player;

    try {
      await player.initialize();

      if (!MediaSource.isTypeSupported(this.mime)) {
        throw new Error(`cue container unsupported: ${this.mime}`);
      }

      const source = new MediaSource();
      const appended = fetchAndAppend(source, this.mime, uri);
      player.srcObject = source;
      const bytes = await appended;
      log(`cue.audio bytes=${bytes}`);

      await new Promise<void>((resolve, reject) => {
        player.addEventListener('error', () => {
          const code = player.error?.code ?? -1;
          reject(new Error(`cue media error ${code}`));
        });
        player.addEventListener('ended', () => {
          log(`cue.audio state=ended t=${player.currentTime.toFixed(2)}`);
          resolve();
        });
        player.play().catch(reject);
      });
    } finally {
      this.current = null;
      await player.deinitialize().catch(() => {
        // a cue that cannot be torn down must not stop the film
      });
    }
  }

  stop(): void {
    this.current?.pause();
  }
}

class VegaLifecycle implements AppLifecycle {
  onBackground(cb: () => void): Unsubscribe {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cb();
    });
    return () => sub.remove();
  }
}

export function createVegaAdapter(options: VegaAdapterOptions = {}): MediaAdapter {
  const video = new VegaVideo(
    options.videoMime ?? DEFAULT_VIDEO_MIME,
    options.window ?? DEFAULT_WINDOW,
  );

  function VideoSurface({ style }: VideoSurfaceProps) {
    const onCreated = useCallback((handle: string) => video.attachSurface(handle), []);
    const onDestroyed = useCallback((handle: string) => video.detachSurface(handle), []);

    return (
      <KeplerVideoSurfaceView
        style={style}
        scalingmode="fit"
        onSurfaceViewCreated={onCreated}
        onSurfaceViewDestroyed={onDestroyed}
      />
    );
  }

  return {
    video,
    clips: new VegaClips(options.clipMime ?? DEFAULT_CLIP_MIME),
    lifecycle: new VegaLifecycle(),
    VideoSurface,
  };
}
