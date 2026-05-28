#!/usr/bin/env node
/**
 * Cross-platform test runner — discovers *.test.mjs under tests/ recursively.
 * Avoids shell glob issues on Linux CI.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function findTests(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...findTests(path));
    } else if (name.endsWith('.test.mjs')) {
      files.push(path);
    }
  }
  return files.sort();
}

const tests = findTests('tests');
if (tests.length === 0) {
  console.error('No test files found under tests/');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', ...tests],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  },
);

process.exit(result.status ?? 1);
