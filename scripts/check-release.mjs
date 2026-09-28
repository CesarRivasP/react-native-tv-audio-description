/**
 * What must be true before a version leaves this repository.
 *
 *   node scripts/check-release.mjs                  everything (prepublishOnly)
 *   node scripts/check-release.mjs --changelog-only  just the changelog (npm version)
 *
 * 1. CHANGELOG.md has a dated `## [x.y.z] - YYYY-MM-DD` section for the version
 *    in package.json, and a compare/tag link for it.
 * 2. The working tree is clean, so what is published is what is committed.
 * 3. HEAD carries the tag `vx.y.z`, so every published version maps to one
 *    commit anyone can check out.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const esc = version.replace(/\./g, '\\.');
const problems = [];

if (!new RegExp(`^## \\[${esc}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md has no dated "## [${version}] - YYYY-MM-DD" section`);
}
if (!new RegExp(`^\\[${esc}\\]: https://`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md has no "[${version}]: https://..." link`);
}

if (!process.argv.includes('--changelog-only')) {
  const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  if (git('status --porcelain')) problems.push('the working tree has uncommitted changes');
  const tags = git('tag --points-at HEAD').split('\n').filter(Boolean);
  if (!tags.includes(`v${version}`)) {
    problems.push(`HEAD is not tagged v${version} (tags here: ${tags.join(', ') || 'none'})`);
  }
}

if (problems.length) {
  console.error(`release check failed for ${version}:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`release check passed for ${version}`);
