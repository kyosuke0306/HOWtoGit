import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('index.html のキャッシュ用バージョンが最新', () => {
  const out = execFileSync('node', [new URL('../scripts/version.mjs', import.meta.url).pathname, '--check']).toString();
  assert.match(out, /ok/);
});
