import type { DescriptionCue, DescriptionTrack, Verbosity } from './track';
import { trackFileName, VERBOSITY_LEVELS } from './track';
import { MAX_CLIPS_IN_MEMORY } from './budget';
import { log } from './log';

/**
 * Load a track file and refuse to believe it.
 *
 * Validation here is not defensive decoration. The loader does not trust that
 * the producer was well-behaved, and a malformed or missing track must end in
 * a STATED visible and spoken state, never in silence. A silent app with
 * nothing to say is indistinguishable from a working app in a quiet scene.
 */

export type LoadResult =
  | { ok: true; track: DescriptionTrack; loaded_verbosity: Verbosity }
  | { ok: false; reason: 'missing' | 'malformed'; detail: string };

export const CUE_KEYS = [
  'id',
  'start_ms',
  'end_ms',
  'words',
  'text',
  'audio_uri',
  'source_frames_ms',
  'status',
] as const;

export const TRACK_KEYS = [
  'version',
  'asset_id',
  'generated_at',
  'source_subtitles',
  'verbosity',
  'model_id',
  'cues',
] as const;

function validCue(v: unknown): v is DescriptionCue {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  if (CUE_KEYS.some((k) => !(k in c))) return false;
  return (
    typeof c.id === 'string' &&
    typeof c.start_ms === 'number' &&
    typeof c.end_ms === 'number' &&
    typeof c.words === 'number' &&
    typeof c.text === 'string' &&
    typeof c.audio_uri === 'string' &&
    Array.isArray(c.source_frames_ms) &&
    c.source_frames_ms.every((n) => typeof n === 'number') &&
    (c.status === 'ok' || c.status === 'failed')
  );
}

/** Validates a parsed track field for field. */
export function validateTrack(raw: unknown): LoadResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'malformed', detail: 'not an object' };
  }
  const t = raw as Record<string, unknown>;

  const missing = TRACK_KEYS.filter((k) => !(k in t));
  if (missing.length) {
    return { ok: false, reason: 'malformed', detail: `missing ${missing.join(',')}` };
  }
  if (!VERBOSITY_LEVELS.includes(t.verbosity as Verbosity)) {
    return { ok: false, reason: 'malformed', detail: `verbosity=${String(t.verbosity)}` };
  }
  if (!Array.isArray(t.cues) || !t.cues.every(validCue)) {
    return { ok: false, reason: 'malformed', detail: 'cues' };
  }

  return {
    ok: true,
    track: raw as DescriptionTrack,
    loaded_verbosity: t.verbosity as Verbosity,
  };
}

/**
 * Resolve a level by `<asset_id>.<verbosity>.track.json` beside the asset,
 * FALLING BACK to `standard`. The fallback is what stops a missing `detailed`
 * file from turning the feature off.
 *
 * `readJson` is yours: on Vega a packaged file is read with `fetch`, and the
 * platform's own player cannot be pointed at it (PLATFORM.md
 * `url_mode_broken`), so there is no platform loader to delegate to.
 */
export async function loadTrack(
  readJson: (path: string) => Promise<unknown>,
  assetDir: string,
  assetId: string,
  verbosity: Verbosity,
): Promise<LoadResult> {
  const levels: Verbosity[] =
    verbosity === 'standard' ? [verbosity] : [verbosity, 'standard'];

  for (const level of levels) {
    const path = `${assetDir}/${trackFileName(assetId, level)}`;
    let raw: unknown;
    try {
      raw = await readJson(path);
    } catch {
      log(`loader.miss path=${path}`);
      continue;
    }

    const result = validateTrack(raw);
    log(
      `loader.load path=${path} ok=${result.ok}` +
        (result.ok ? ` cues=${result.track.cues.length}` : ` reason=${result.reason}`),
    );

    // A malformed file is an error, not a reason to fall back: something
    // produced a file that is not a track, and silently loading a different
    // one would hide it.
    return result;
  }

  return { ok: false, reason: 'missing', detail: trackFileName(assetId, verbosity) };
}

/**
 * A bounded clip cache, oldest out first.
 *
 * It holds BYTES, not URIs, and on Vega that is forced rather than chosen:
 * there is no URI a player will fetch (PLATFORM.md `url_mode_broken`), so
 * every clip is read by the app and appended through a MediaSource.
 */
export class ClipCache {
  private order: string[] = [];
  private held = new Map<string, ArrayBuffer>();

  constructor(private readonly max: number = MAX_CLIPS_IN_MEMORY) {}

  put(uri: string, bytes: ArrayBuffer): void {
    if (this.held.has(uri)) this.order = this.order.filter((u) => u !== uri);
    this.held.set(uri, bytes);
    this.order.push(uri);
    while (this.order.length > this.max) {
      const evicted = this.order.shift()!;
      this.held.delete(evicted);
      log(`cache.evict uri=${evicted} size=${this.held.size}`);
    }
  }

  get(uri: string): ArrayBuffer | undefined {
    return this.held.get(uri);
  }

  get size(): number {
    return this.held.size;
  }
}
