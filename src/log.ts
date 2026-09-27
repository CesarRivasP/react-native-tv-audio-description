/**
 * Where this library's diagnostic lines go. Nowhere, by default.
 *
 * It is injectable rather than `console.log` because on Vega there is no
 * readable JavaScript console at all — `console.log` reaches neither the
 * device log stream nor the Metro terminal, in Release or in Debug (see
 * PLATFORM.md, `no_js_console`). An app that needs to see these lines on a
 * device has to ship them somewhere itself, usually an HTTP beacon to the
 * development host, and only the app knows where that is.
 *
 * Lines are `area.event key=value ...` with no prefix; add your own.
 *
 *   setLogger(line => beacon(`MYAPP.${line}`));
 */
export type Logger = (line: string) => void;

const silent: Logger = () => undefined;
let sink: Logger = silent;

export function setLogger(logger: Logger | null): void {
  sink = logger ?? silent;
}

export function log(line: string): void {
  try {
    sink(line);
  } catch {
    // diagnostics must never break playback
  }
}
