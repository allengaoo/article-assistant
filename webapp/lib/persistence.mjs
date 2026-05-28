/**
 * Session persistence layer.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data',
);

export function getDataDir() {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function sessionFile(date, sessionId) {
  return path.join(getDataDir(), 'sessions', date, `${sessionId}.json`);
}

export function persistSession(sessionId, sessionData) {
  const date = todayStr();
  const file = sessionFile(date, sessionId);
  const dir = path.dirname(file);

  const snapshot = {
    sessionId,
    savedAt: new Date().toISOString(),
    mode: sessionData.mode ?? 'article',
    inputType: sessionData.inputType,
    step: sessionData.step,
    rawContent: sessionData.rawContent?.slice(0, 2000) ?? null,
    currentOutline: sessionData.currentOutline?.slice(0, 1000) ?? null,
    outlineRounds: sessionData.outlineHistory?.length ?? 0,
    articleTitle: sessionData.article?.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? null,
    published: sessionData.step === 'published',
  };

  setImmediate(() => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.error(`[persistence] write failed: ${e.message}`);
    }
  });
}

export function persistSessionSync(sessionId, sessionData) {
  const date = todayStr();
  const file = sessionFile(date, sessionId);
  const dir = path.dirname(file);
  const snapshot = {
    sessionId,
    savedAt: new Date().toISOString(),
    mode: sessionData.mode ?? 'article',
    step: sessionData.step ?? 'extracted',
    outlineRounds: sessionData.outlineHistory?.length ?? 0,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export function loadSessionsForDate(date = todayStr()) {
  const dir = path.join(getDataDir(), 'sessions', date);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))];
      } catch {
        return [];
      }
    });
}

export function listSessionDates() {
  const dir = path.join(getDataDir(), 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}
