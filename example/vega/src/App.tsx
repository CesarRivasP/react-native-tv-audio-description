import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  setLogger,
  trackFileName,
  type AssetSource,
  type DescriptionTrack,
  type Verbosity,
} from 'react-native-tv-audio-description';
import { Player } from './Player';
import { CUES } from './cues';

/**
 * react-native-tv-audio-description on Vega OS.
 *
 * The first 20 s of Tears of Steel, cut into fragmented-MP4 segments, with four
 * description cues at two verbosity levels. Everything the device has to play
 * travels inside the package, because Vega's media pipeline runs in its own
 * process and cannot reach the host (PLATFORM.md `media_process_is_separate`).
 */

// Metro resolves `require` at build time, so every asset is named statically.
const uri = (mod: number) => Image.resolveAssetSource(mod)?.uri ?? '';

// Timings read from the HLS playlist ffmpeg emitted: it cuts on keyframes, so
// the segments are uneven (9.94 s, 4.17 s, 5.29 s, 0.65 s).
const ASSET: AssetSource = {
  initUri: uri(require('./assets/seg/init.mp4')),
  segments: [
    { index: 0, start_ms: 0, end_ms: 9_940, uri: uri(require('./assets/seg/seg0000.m4s')) },
    { index: 1, start_ms: 9_940, end_ms: 14_107, uri: uri(require('./assets/seg/seg0001.m4s')) },
    { index: 2, start_ms: 14_107, end_ms: 19_399, uri: uri(require('./assets/seg/seg0002.m4s')) },
    { index: 3, start_ms: 19_399, end_ms: 20_047, uri: uri(require('./assets/seg/seg0003.m4s')) },
  ],
};

const CLIPS: Record<string, number> = {
  'c1.standard': require('./assets/cues/c1.standard.m4a'),
  'c2.standard': require('./assets/cues/c2.standard.m4a'),
  'c3.standard': require('./assets/cues/c3.standard.m4a'),
  'c4.standard': require('./assets/cues/c4.standard.m4a'),
  'c1.concise': require('./assets/cues/c1.concise.m4a'),
  'c2.concise': require('./assets/cues/c2.concise.m4a'),
  'c3.concise': require('./assets/cues/c3.concise.m4a'),
  'c4.concise': require('./assets/cues/c4.concise.m4a'),
};

const ASSET_ID = 'tears-of-steel-excerpt';
const TRACK_DIR = 'tracks';

function track(verbosity: Exclude<Verbosity, 'detailed'>): DescriptionTrack {
  return {
    version: '1',
    asset_id: ASSET_ID,
    generated_at: '2026-09-27T00:00:00.000Z',
    source_subtitles: 'tears-of-steel.en.srt',
    verbosity,
    model_id: 'hand-written for this example; voiced by Amazon Polly (neural, Joanna)',
    cues: CUES.map((c) => ({
      id: c.id,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
      words: c[verbosity].split(/\s+/).length,
      text: c[verbosity],
      audio_uri: uri(CLIPS[`${c.id}.${verbosity}`]!),
      source_frames_ms: [c.frame_ms],
      status: 'ok',
    })),
  };
}

// The tracks are bundled rather than read from files; `detailed` is left out
// on purpose, so choosing it shows the fallback to `standard`.
const TRACKS: Record<string, DescriptionTrack> = {
  [`${TRACK_DIR}/${trackFileName(ASSET_ID, 'standard')}`]: track('standard'),
  [`${TRACK_DIR}/${trackFileName(ASSET_ID, 'concise')}`]: track('concise'),
};

const readJson = async (path: string): Promise<unknown> => {
  const found = TRACKS[path];
  if (!found) throw new Error(`no such track: ${path}`);
  return found;
};

// Vega has no readable JS console (PLATFORM.md `no_js_console`): diagnostic
// lines go to `npm run beacon` on the host, over the reverse port forward.
setLogger((line) => {
  void fetch(`http://localhost:8098/?m=${encodeURIComponent(`tvad.${line}`)}`).catch(() => {});
});

export function App() {
  return (
    <View style={styles.root}>
      <Player asset={ASSET} trackDir={TRACK_DIR} assetId={ASSET_ID} readJson={readJson} />
    </View>
  );
}

const styles = StyleSheet.create({
  // ADControls is unstyled on purpose, and its default text is black.
  root: { flex: 1, backgroundColor: '#fff' },
});
