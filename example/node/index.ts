/**
 * `npm run example` — the description layer, end to end, in a terminal.
 *
 * A minute of an imaginary film plays at 20x against a simulated adapter.
 * Everything above the adapter is the library's real code: the track is
 * loaded and validated by `loadTrack`, cues are fired by `CueScheduler`,
 * ducked and restored by `DescriptionAudio`, and a held remote key is
 * collapsed by `coalesce`. The wiring in `play()` is the wiring a player
 * screen does.
 *
 * It also CHECKS what it shows, and exits non-zero if an invariant breaks:
 * a cue fired outside its gap, speech still running when dialogue resumes,
 * the film left ducked, a skipped or failed cue spoken anyway.
 *
 *   npm run example              the story
 *   npm run example -- --verbose plus the library's own diagnostic lines
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

import { CueScheduler, coalesce } from '../../src/CueScheduler';
import { DescriptionAudio } from '../../src/DescriptionAudio';
import { loadTrack, type LoadResult } from '../../src/TrackLoader';
import { stateMessage, type ADState } from '../../src/messages';
import { AD, wordCeiling } from '../../src/budget';
import { setLogger } from '../../src/log';
import type { DescriptionCue, DescriptionTrack } from '../../src/track';
import { createSimAdapter } from './simAdapter';

const SPEED = 20;
const FILM_MS = 60_000;
/** film time between position reports, like a platform's 'timeupdate' */
const TICK_MS = 250;
const ASSETS = join(__dirname, '..', 'assets');

const verbose = process.argv.includes('--verbose');
const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);

const clock = (ms: number) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let filmNow = 0;
const say = (line: string) => console.log(`  ${dim(clock(filmNow))}  ${line}`);
const note = (line: string) => console.log(`             ${dim(line)}`);

const failures: string[] = [];
function check(ok: boolean, what: string): void {
  if (!ok) failures.push(what);
}

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

function speak(state: ADState): void {
  say(`🔊 "${stateMessage(state)}"`);
}

async function load(verbosity: 'concise' | 'standard' | 'detailed', assetId = 'lighthouse') {
  const result = await loadTrack(readJson, ASSETS, assetId, verbosity);
  return result;
}

function describeLoad(asked: string, result: LoadResult): void {
  if (result.ok) {
    const fell = result.loaded_verbosity !== asked;
    say(
      `asked for ${bold(asked)} → loaded ${bold(result.loaded_verbosity)}` +
        ` (${result.track.cues.length} cues)` +
        (fell ? `  ${dim(`no ${asked} file, fell back to standard`)}` : ''),
    );
  } else {
    say(`asked for ${bold(asked)} → ${red(result.reason)} (${result.detail})`);
  }
}

// ---------------------------------------------------------------------------

async function play(track: DescriptionTrack): Promise<void> {
  const byUri = new Map(track.cues.map((c) => [c.audio_uri, c] as const));
  const media = createSimAdapter(FILM_MS, SPEED, (uri) => byUri.get(uri)?.words ?? 0);
  const { video } = media;
  // the printed clock follows the film; registered first, so it is current
  // by the time the scheduler hears the same position
  video.onPosition((ms) => (filmNow = ms));

  // --- the wiring a player screen does -----------------------------------
  const audio = new DescriptionAudio(media, { rampMs: AD.DUCK_RAMP_MS / SPEED });
  const fired: Array<{ cue: DescriptionCue; atMs: number }> = [];
  const scheduler = new CueScheduler({
    onFire: (cue) => {
      fired.push({ cue, atMs: video.positionMs() });
      say(`${bold('▶ ' + cue.id)} in gap [${secs(cue.start_ms)}–${secs(cue.end_ms)})  "${cue.text}"`);
      void audio.speak(cue);
    },
  });
  scheduler.load(track.cues);
  video.onPosition((ms) => scheduler.tick(ms));
  video.onSeek((ms) => scheduler.resync(ms));
  // -------------------------------------------------------------------------

  // Report the duck as the viewer would hear it: down, then back up.
  let ducked = false;
  const volumeWatch = setInterval(() => {
    const pct = video.volumePct();
    const cue = fired[fired.length - 1]?.cue;
    if (!ducked && pct <= AD.DUCK_TARGET_PCT) {
      ducked = true;
      say(dim(`  film ducked to ${pct}%, cue speaking`));
    } else if (ducked && pct >= 100) {
      ducked = false;
      say(dim(`  film back to 100%` + (cue ? ` — dialogue resumes at ${secs(cue.end_ms)}` : '')));
    }
  }, 1);

  const script: Array<{ atMs: number; run: () => Promise<void> }> = [
    {
      atMs: 22_000,
      run: async () => {
        say(`${bold('⏩ remote')}: RIGHT held — 6 key events, +2 s each`);
        video.pause();
        const settled = new Promise<number>((resolve) => {
          const settle = coalesce((target) => resolve(target), 250);
          for (let i = 1; i <= 6; i++) settle(22_000 + i * 2_000);
        });
        const target = await settled;
        video.seekTo(target);
        filmNow = target;
        say(`seek settled at ${secs(target)} — one resync, not six; c3's gap was jumped over`);
        await video.play();
      },
    },
    {
      atMs: 36_000,
      run: async () => {
        scheduler.setEnabled(false);
        say(`${bold('⏸ remote')}: description OFF`);
        speak({ kind: 'ready', enabled: false, verbosity: track.verbosity, cues: track.cues.length });
      },
    },
    {
      atMs: 38_500,
      run: async () => {
        scheduler.setEnabled(true);
        say(`${bold('⏵ remote')}: description ON — c4's gap is still open, so it can still fire`);
      },
    },
  ];

  await video.play();
  while (video.isPlaying() || video.positionMs() < FILM_MS) {
    const next = script[0];
    if (next && video.positionMs() >= next.atMs) {
      script.shift();
      await next.run();
      continue;
    }
    await sleep(TICK_MS / SPEED);
    video.advance(TICK_MS);
    filmNow = video.positionMs();
    if (!video.isPlaying() && video.positionMs() >= FILM_MS) break;
  }
  // let the last restore land
  await sleep(50);
  clearInterval(volumeWatch);
  say('■ end of film');

  // --- the checks ----------------------------------------------------------
  for (const { cue, atMs } of fired) {
    check(atMs >= cue.start_ms && atMs < cue.end_ms, `${cue.id} fired at ${atMs}, outside its gap`);
  }
  for (const clip of media.clips.played) {
    const cue = byUri.get(clip.uri)!;
    check(
      clip.endMs <= cue.end_ms,
      `${cue.id} was still speaking at ${secs(clip.endMs)}, after dialogue resumed at ${secs(cue.end_ms)}`,
    );
  }
  const ids = fired.map((f) => f.cue.id);
  check(!ids.includes('c3'), 'c3 fired although the seek jumped over its gap');
  check(!ids.includes('c5'), 'c5 fired although it is a failed cue with no audio');
  check(ids.join(',') === 'c1,c2,c4,c6', `expected c1,c2,c4,c6 to fire, got ${ids.join(',')}`);
  const lowest = Math.min(...video.volumes.map((v) => v.pct));
  check(lowest === AD.DUCK_TARGET_PCT, `the film ducked to ${lowest}%, not ${AD.DUCK_TARGET_PCT}%`);
  check(video.volumePct() === 100, `the film ended at ${video.volumePct()}%, not restored`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (verbose) setLogger((line) => note(`[lib] ${line}`));

  console.log(bold('\nreact-native-tv-audio-description — example\n'));
  console.log(
    dim(
      `A 60 s film at ${SPEED}x against a simulated adapter. Dialogue gaps, cues and\n` +
        `timings are film time. Every component above the adapter is the library's.\n`,
    ),
  );

  console.log(bold('1. Loading tracks'));
  const standard = await load('standard');
  describeLoad('standard', standard);
  describeLoad('concise', await load('concise'));
  describeLoad('detailed', await load('detailed'));
  const broken = await load('standard', 'broken');
  describeLoad('standard (broken file)', broken);
  if (!broken.ok) speak({ kind: broken.reason, detail: broken.detail });
  check(!broken.ok && broken.reason === 'malformed', 'the broken track was not rejected');
  const missing = await load('standard', 'nothing-here');
  if (!missing.ok) speak({ kind: missing.reason, detail: missing.detail });

  if (!standard.ok) throw new Error('the example track failed to load');
  const track = standard.track;

  console.log(bold('\n2. Does every cue fit its gap?'));
  for (const cue of track.cues) {
    if (cue.status === 'failed') {
      say(`${cue.id}  gap ${secs(cue.end_ms - cue.start_ms)}  ${dim('failed — kept in the track, never scheduled')}`);
      continue;
    }
    const ceiling = wordCeiling(cue.end_ms - cue.start_ms);
    const fits = cue.words <= ceiling;
    say(
      `${cue.id}  gap ${secs(cue.end_ms - cue.start_ms)}  ${cue.words}/${ceiling} words  ` +
        (fits ? green('fits') : red('TOO LONG')),
    );
    check(fits, `${cue.id} has ${cue.words} words for a ${ceiling}-word gap`);
  }

  console.log(bold('\n3. Playing'));
  filmNow = 0;
  speak({ kind: 'ready', enabled: true, verbosity: track.verbosity, cues: track.cues.length });
  await play(track);

  console.log('');
  if (failures.length) {
    console.log(red(bold(`✗ ${failures.length} invariant(s) broken:`)));
    for (const f of failures) console.log(red(`  - ${f}`));
    process.exitCode = 1;
  } else {
    console.log(
      green(bold('✓ all invariants held')) +
        dim(
          ' — every cue fired inside its gap and finished before dialogue resumed, the\n' +
            '  jumped-over and failed cues stayed silent, and the film always came back to 100%.\n',
        ),
    );
  }
}

main().catch((err) => {
  console.error(red(String(err instanceof Error ? err.stack : err)));
  process.exitCode = 1;
});
