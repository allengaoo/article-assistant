/**
 * In-memory session store for one pipeline run per session.
 */

const sessions = new Map();

export const TTL_MS = process.env.SESSION_TTL_MS
  ? Number(process.env.SESSION_TTL_MS)
  : 4 * 60 * 60 * 1000;

export function createSession(id) {
  const session = {
    id,
    createdAt: Date.now(),
    step: 'extracted',
    inputType: null,
    rawContent: null,
    outlineHistory: [],
    currentOutline: null,
    article: null,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export function updateSession(id, updates) {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, updates);
  return s;
}

export function clearSessions() {
  sessions.clear();
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > TTL_MS) sessions.delete(id);
    }
  }, 30 * 60 * 1000);
}
