import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The boundary that makes this a library rather than a Vega app with a
 * package-shaped README: only `src/vega/` may name a platform package.
 * Everything else is written against `MediaAdapter`.
 */
const SRC = join(__dirname, '..', 'src');
const PLATFORM_PACKAGE = /from\s+['"]@amazon-devices\//;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('the platform seam', () => {
  // Fails if: core code imports a platform package. The core would then stop
  // loading anywhere but on that platform, and every other adapter is dead.
  it('no file outside src/vega/ names a platform package', () => {
    const offenders = walk(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => !rel.startsWith('vega/'))
      .filter((rel) => PLATFORM_PACKAGE.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the core entry point does not re-export the Vega adapter', () => {
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/['"]\.\/vega/);
  });
});
