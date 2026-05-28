import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  persistSessionSync,
  loadSessionsForDate,
} from '../webapp/lib/persistence.mjs';

describe('persistence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-test-'));
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads session snapshot', () => {
    const today = new Date().toISOString().slice(0, 10);
    persistSessionSync('sess-1', { step: 'articled', outlineHistory: [{}, {}] });

    const sessions = loadSessionsForDate(today);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'sess-1');
    assert.equal(sessions[0].outlineRounds, 2);
  });

  it('returns empty array when no sessions for date', () => {
    assert.deepEqual(loadSessionsForDate('2099-01-01'), []);
  });
});
