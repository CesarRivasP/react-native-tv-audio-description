import 'react-native';
import * as React from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ADControls, stateMessage, type ADState } from '../src/ADControls';

const ready = (over: Partial<Extract<ADState, { kind: 'ready' }>> = {}): ADState => ({
  kind: 'ready',
  enabled: true,
  verbosity: 'standard',
  cues: 55,
  ...over,
});

let announced: string[] = [];

beforeEach(() => {
  announced = [];
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation((m: string) => {
      announced.push(m);
    });
});

afterEach(() => jest.restoreAllMocks());

const noop = () => undefined;

describe('stateMessage — every branch has a sentence', () => {
  it('names the level and the count when description is on', () => {
    expect(stateMessage(ready())).toBe('Audio description on, standard, 55 descriptions');
  });

  it('has a sentence for off, for missing and for malformed', () => {
    expect(stateMessage(ready({ enabled: false }))).toBe('Audio description off');
    expect(stateMessage({ kind: 'missing', detail: 'x' })).toMatch(/No description track/);
    expect(stateMessage({ kind: 'malformed', detail: 'x' })).toMatch(/could not be read/);
  });

  // Fails if: a failure sentence stops telling the viewer the film still plays.
  // "No description track was found" alone reads as "this title is broken", and
  // a blind viewer has no way to check that the picture is fine.
  it('tells the viewer playback continues, on both failure branches', () => {
    expect(stateMessage({ kind: 'missing', detail: 'x' })).toMatch(/Playback continues/);
    expect(stateMessage({ kind: 'malformed', detail: 'x' })).toMatch(/Playback continues/);
  });
});

describe('ADControls — what it SAYS, which is all its users get', () => {
  it('announces its state on mount', () => {
    render(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    expect(announced).toEqual([stateMessage(ready())]);
  });

  // Fails if: the announcement is rendered but never spoken. Every assertion
  // here goes through announceForAccessibility rather than through the visible
  // text, because the visible text is the half these users do not receive.
  it('announces the failure states too, as alerts', () => {
    const state: ADState = { kind: 'missing', detail: 'track.json' };
    const view = render(<ADControls state={state} onToggle={noop} onVerbosity={noop} />);
    expect(announced).toEqual([stateMessage(state)]);
    expect(view.getByLabelText(stateMessage(state))).toBeTruthy();
  });

  it('announces again when the state changes', () => {
    const view = render(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    view.rerender(<ADControls state={ready({ enabled: false })} onToggle={noop} onVerbosity={noop} />);
    expect(announced).toEqual([
      'Audio description on, standard, 55 descriptions',
      'Audio description off',
    ]);
  });

  // Fails if: an unchanged state re-announces. A re-render that speaks again
  // talks over the film for no reason, on the one channel these users have.
  it('does NOT re-announce an unchanged state', () => {
    const view = render(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    view.rerender(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    expect(announced).toHaveLength(1);
  });
});

describe('ADControls — the toggle never touches the video', () => {
  it('reports the NEW value to its caller', () => {
    const onToggle = jest.fn();
    const view = render(<ADControls state={ready()} onToggle={onToggle} onVerbosity={noop} />);
    fireEvent.press(view.getByLabelText('Audio description'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('carries its on/off state in accessibilityState, not only in its label', () => {
    const view = render(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    expect(view.getByLabelText('Audio description').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('does nothing when there is no track to toggle', () => {
    const onToggle = jest.fn();
    render(
      <ADControls
        state={{ kind: 'malformed', detail: 'cues' }}
        onToggle={onToggle}
        onVerbosity={noop}
      />,
    );
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('ADControls — three levels reachable from the remote', () => {
  it('offers all three, each with its own label', () => {
    const view = render(<ADControls state={ready()} onToggle={noop} onVerbosity={noop} />);
    for (const level of ['concise', 'standard', 'detailed']) {
      expect(view.getByLabelText(`${level} description`)).toBeTruthy();
    }
  });

  it('marks the active level as selected, and only that one', () => {
    const view = render(
      <ADControls state={ready({ verbosity: 'detailed' })} onToggle={noop} onVerbosity={noop} />,
    );
    expect(view.getByLabelText('detailed description').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(view.getByLabelText('concise description').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('asks its caller to switch level', () => {
    const onVerbosity = jest.fn();
    const view = render(<ADControls state={ready()} onToggle={noop} onVerbosity={onVerbosity} />);
    fireEvent.press(view.getByLabelText('concise description'));
    expect(onVerbosity).toHaveBeenCalledWith('concise');
  });

  // Fails if: the level selector stays live while description is off. A viewer
  // who switches level with description off gets no feedback at all — nothing
  // plays, so nothing confirms the press — and the state is announced as
  // disabled precisely so that does not happen silently.
  it('announces the level selector as disabled when description is off', () => {
    const onVerbosity = jest.fn();
    const view = render(
      <ADControls state={ready({ enabled: false })} onToggle={noop} onVerbosity={onVerbosity} />,
    );
    expect(view.getByLabelText('concise description').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(view.getByLabelText('concise description'));
    expect(onVerbosity).not.toHaveBeenCalled();
  });
});
