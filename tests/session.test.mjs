import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  getSession,
  updateSession,
  clearSessions,
  TTL_MS,
} from '../webapp/lib/session.mjs';

describe('session', () => {
  beforeEach(() => clearSessions());

  it('creates and retrieves a session', () => {
    const s = createSession('abc');
    assert.equal(s.id, 'abc');
    assert.equal(s.step, 'extracted');
    assert.ok(getSession('abc'));
  });

  it('updates session fields', () => {
    createSession('abc');
    const updated = updateSession('abc', { step: 'outlined', rawContent: 'hello' });
    assert.equal(updated.step, 'outlined');
    assert.equal(getSession('abc').rawContent, 'hello');
  });

  it('returns null for unknown session', () => {
    assert.equal(getSession('missing'), null);
  });

  it('expires sessions past TTL', () => {
    createSession('old');
    const s = getSession('old');
    s.createdAt = Date.now() - TTL_MS - 1;
    assert.equal(getSession('old'), null);
  });
});
