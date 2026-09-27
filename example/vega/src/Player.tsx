// The README's usage example, compiled by `npm run typecheck` so it cannot
// drift from the API it documents.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  ADControls,
  CueScheduler,
  DescriptionAudio,
  loadTrack,
  type ADState,
  type AssetSource,
  type Verbosity,
} from 'react-native-tv-audio-description';
import { createVegaAdapter } from 'react-native-tv-audio-description/vega';

// Vega's player cannot be pointed at a path, but fetch can read a packaged file.
const fetchJson = async (path: string): Promise<unknown> => (await fetch(path)).json();

interface PlayerProps {
  asset: AssetSource; // the film, cut into fragmented-MP4 segments
  trackDir: string; // where <assetId>.<verbosity>.track.json live
  assetId: string;
  readJson?: (path: string) => Promise<unknown>; // how to read a track file
}

export function Player({ asset, trackDir, assetId, readJson = fetchJson }: PlayerProps) {
  // One adapter, one audio layer, one scheduler per screen.
  const media = useMemo(() => createVegaAdapter(), []);
  const audio = useMemo(() => new DescriptionAudio(media), [media]);
  const scheduler = useMemo(
    () => new CueScheduler({ onFire: (cue) => void audio.speak(cue) }),
    [audio],
  );

  const [verbosity, setVerbosity] = useState<Verbosity>('standard');
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<ADState>({ kind: 'missing', detail: 'loading' });

  // Position drives the scheduler; a settled seek resyncs it.
  useEffect(() => {
    const offs = [
      media.video.onPosition((ms) => scheduler.tick(ms)),
      media.video.onSeek((ms) => scheduler.resync(ms)),
    ];
    void media.video.open(asset).then(() => media.video.play());
    return () => {
      offs.forEach((off) => off());
      void audio.stop();
      void media.video.destroy();
    };
  }, [media, audio, scheduler, asset]);

  // A level switch loads that level's file, falling back to standard.
  useEffect(() => {
    void loadTrack(readJson, trackDir, assetId, verbosity).then((result) => {
      if (!result.ok) {
        scheduler.load([]);
        setState({ kind: result.reason, detail: result.detail });
        return;
      }
      scheduler.load(result.track.cues);
      scheduler.resync(media.video.positionMs());
      setState({
        kind: 'ready',
        enabled,
        verbosity: result.loaded_verbosity,
        cues: result.track.cues.length,
      });
    });
    // `enabled` is applied separately below; reloading on a toggle is not needed
  }, [media, scheduler, trackDir, assetId, verbosity, readJson]);

  const onToggle = (on: boolean) => {
    setEnabled(on);
    scheduler.setEnabled(on); // the film is never touched by a toggle
    if (!on) void audio.stop(); // cuts a cue mid-sentence and restores the film
    setState((s) => (s.kind === 'ready' ? { ...s, enabled: on } : s));
  };

  return (
    <View style={{ flex: 1 }}>
      <media.VideoSurface style={{ flex: 1 }} />
      <ADControls state={state} onToggle={onToggle} onVerbosity={setVerbosity} />
    </View>
  );
}
