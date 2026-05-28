import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('knowledge notes cap', () => {
  let tmpDir;
  let notesFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-knowledge-'));
    notesFile = path.join(tmpDir, 'notes.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps only the last 200 notes when appending', () => {
    const MAX = 200;
    const existing = Array.from({ length: 195 }, (_, i) => ({ date: '2026-01-01', note: `n${i}` }));
    const newEntries = Array.from({ length: 10 }, (_, i) => ({ date: '2026-01-02', note: `new${i}` }));
    const updated = [...existing, ...newEntries].slice(-MAX);
    fs.writeFileSync(notesFile, JSON.stringify(updated));
    const loaded = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
    assert.equal(loaded.length, MAX);
    assert.equal(loaded[0].note, 'n5');
    assert.equal(loaded.at(-1).note, 'new9');
  });
});
