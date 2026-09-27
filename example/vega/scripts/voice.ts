/**
 * Voice the example's cues with Amazon Polly and package them the way Vega
 * needs: fragmented MP4, AAC-LC. An MP3 cannot be appended to a SourceBuffer,
 * and Vega's players fetch nothing themselves (PLATFORM.md `url_mode_broken`,
 * `mse_path`).
 *
 * Needs AWS credentials with polly:SynthesizeSpeech, the AWS CLI and ffmpeg.
 * The clips are committed, so running the example does NOT need any of this.
 *
 *   npx tsx example/vega/scripts/voice.ts      (from the repository root)
 */
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { CUES } from '../src/cues';
import { AD } from '../../../src/budget';

const OUT = join(__dirname, '..', 'src', 'assets', 'cues');
const VOICE = process.env.POLLY_VOICE_ID ?? 'Joanna';
const levels = ['standard', 'concise'] as const;
/** a player reports position a few times a second; a cue fires on the first report inside its window */
const FIRST_UPDATE_MS = 250;
/**
 * AudioPlayer initialise, fetch and append, on top of the fade down. Measured
 * on the Vega Virtual Device: 250-290 ms from "fire" to the clip's bytes
 * appended, of which 200 ms is the fade; rounded up.
 */
const CLIP_START_MS = 150;

mkdirSync(OUT, { recursive: true });
const failures: string[] = [];

for (const cue of CUES) {
  for (const level of levels) {
    const text = cue[level];
    const mp3 = join(OUT, `${cue.id}.${level}.mp3`);
    const m4a = join(OUT, `${cue.id}.${level}.m4a`);

    execFileSync('aws', [
      'polly', 'synthesize-speech',
      '--engine', 'neural', '--voice-id', VOICE, '--output-format', 'mp3',
      '--text', text, mp3,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', mp3,
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
      m4a,
    ]);
    rmSync(mp3);

    const seconds = Number(
      execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', m4a,
      ]).toString(),
    );
    const speaksMs = Math.round(seconds * 1000);
    // fired on the first position update inside the window, faded down,
    // started, spoken, faded back up. The fade down and the clip start overlap
    // in practice; counting both keeps the margin on the safe side.
    const needsMs =
      FIRST_UPDATE_MS + AD.DUCK_RAMP_MS + CLIP_START_MS + speaksMs + AD.DUCK_RAMP_MS;
    const windowMs = cue.end_ms - cue.start_ms;
    const fits = needsMs <= windowMs;
    console.log(
      `${cue.id}.${level.padEnd(8)} ${String(speaksMs).padStart(5)} ms spoken, ` +
        `${needsMs} of ${windowMs} ms window  ${fits ? 'fits' : 'TOO LONG'}  "${text}"`,
    );
    if (!fits) failures.push(`${cue.id}.${level}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} clip(s) overrun their window: ${failures.join(', ')}`);
  process.exitCode = 1;
}
