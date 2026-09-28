import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the README', () => {
  // Fails if: the usage example in the README is edited without the compiled
  // file, or the other way round. The file is what `npm run typecheck`
  // compiles against the library; the README is what people copy.
  it('shows exactly the usage example that the typecheck compiles', () => {
    const readme = read('README.md');
    const block = /## Usage[\s\S]*?```tsx\n([\s\S]*?)```/.exec(readme)?.[1];
    const file = read('example/vega/src/Player.tsx').split('\n').slice(2).join('\n');
    expect(block).toBe(file);
  });

  it('links only to PLATFORM.md sections that exist', () => {
    const platform = read('PLATFORM.md');
    const anchors = [...read('README.md').matchAll(/PLATFORM\.md#([a-z_]+)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(0);
    const missing = anchors.filter((a) => !new RegExp(`^### ${a}\\b`, 'm').test(platform));
    expect(missing).toEqual([]);
  });
});

describe('the CHANGELOG', () => {
  // Fails if: the version in package.json has no dated changelog section. The
  // same rule stops `npm publish` (scripts/check-release.mjs); here it fails
  // on the commit that bumps the version, rather than at publish time.
  it('has a dated section for the version in package.json', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    const esc = version.replace(/\./g, '\\.');
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## \\[${esc}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  });
});
