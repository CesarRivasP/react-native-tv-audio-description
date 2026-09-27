import React, { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import type { Verbosity } from './track';
import { VERBOSITY_LEVELS } from './track';
import { log } from './log';
import { stateMessage, type ADState } from './messages';

export { stateMessage, type ADState } from './messages';

/**
 * The remote surface, and every failure said out loud.
 *
 * This is for blind and low-vision viewers. A control surface that shows an
 * error and says nothing is the same as silence, so every assertion in its
 * test suite is about what is ANNOUNCED, not about what is rendered.
 *
 * It is deliberately unstyled: bring your own look. What it guarantees is the
 * accessibility contract — roles, labels, state, and one announcement per
 * state change.
 */

export interface ADControlsProps {
  state: ADState;
  onToggle: (enabled: boolean) => void;
  onVerbosity: (v: Verbosity) => void;
  /** hand focus here when the player screen mounts */
  focusRef?: React.Ref<View>;
}

export function ADControls({ state, onToggle, onVerbosity, focusRef }: ADControlsProps) {
  const lastSpoken = useRef<string>('');

  // Announce on entry and on every state change, once each. The guard is not
  // an optimisation — re-announcing an unchanged state talks over the film for
  // no reason, and this screen is already competing for the one channel its
  // users have.
  useEffect(() => {
    const message = stateMessage(state);
    if (message === lastSpoken.current) return;
    lastSpoken.current = message;
    AccessibilityInfo.announceForAccessibility(message);
    log(`controls.announce kind=${state.kind}`);
  }, [state]);

  const toggle = useCallback(() => {
    if (state.kind !== 'ready') return;
    log(`controls.toggle to=${!state.enabled}`);
    onToggle(!state.enabled); // the scheduler flips; the video is untouched
  }, [state, onToggle]);

  if (state.kind !== 'ready') {
    return (
      <View accessible accessibilityRole="alert" accessibilityLabel={stateMessage(state)}>
        <Text>{stateMessage(state)}</Text>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        ref={focusRef}
        accessible
        accessibilityRole="switch"
        accessibilityLabel="Audio description"
        accessibilityState={{ checked: state.enabled }}
        onPress={toggle}
        hasTVPreferredFocus
      >
        <Text>{state.enabled ? 'Description: on' : 'Description: off'}</Text>
      </Pressable>

      {/* three levels, each its own focusable, each announcing its state */}
      {VERBOSITY_LEVELS.map((level) => (
        <Pressable
          key={level}
          accessible
          accessibilityRole="radio"
          accessibilityLabel={`${level} description`}
          accessibilityState={{ selected: state.verbosity === level, disabled: !state.enabled }}
          disabled={!state.enabled}
          onPress={() => {
            log(`controls.verbosity to=${level}`);
            onVerbosity(level);
          }}
        >
          <Text>{level}</Text>
        </Pressable>
      ))}
    </View>
  );
}
