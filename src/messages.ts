import type { Verbosity } from './track';

/**
 * What the description layer is doing, as one sentence a screen reader can
 * say. Kept apart from `ADControls` so it has no React Native dependency:
 * any surface — a custom control, a toast, a test, a Node script — can speak
 * the same sentences.
 */

export type ADState =
  | { kind: 'ready'; enabled: boolean; verbosity: Verbosity; cues: number }
  | { kind: 'missing'; detail: string }
  | { kind: 'malformed'; detail: string };

/** every branch has a sentence, and the sentence is spoken, not only shown */
export function stateMessage(state: ADState): string {
  switch (state.kind) {
    case 'ready':
      return state.enabled
        ? `Audio description on, ${state.verbosity}, ${state.cues} descriptions`
        : 'Audio description off';
    case 'missing':
      return 'No description track was found for this title. Playback continues without description.';
    case 'malformed':
      return 'The description track for this title could not be read. Playback continues without description.';
  }
}
