import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized, extractToken, resolveAuth, ownsPipelineSession, LEGACY_USER_ID } from '../webapp/lib/auth.mjs';

describe('auth', () => {
  it('resolveAuth accepts legacy ACCESS_TOKEN', () => {
    const user = resolveAuth('tok-a', 'tok-a');
    assert.equal(user.role, 'admin');
    assert.equal(user.legacy, true);
    assert.equal(isAuthorized('tok-a', 'tok-a'), true);
  });

  it('rejects wrong token when legacy configured', () => {
    assert.equal(resolveAuth('wrong', 'tok-a'), null);
  });

  it('rejects token when legacy not configured', () => {
    assert.equal(resolveAuth('anything', ''), null);
  });

  it('extracts token from headers, body, or query', () => {
    assert.equal(extractToken({ headers: { 'x-access-token': 'h' } }), 'h');
    assert.equal(extractToken({ headers: { authorization: 'Bearer tok' } }), 'tok');
    assert.equal(extractToken({ body: { token: 'b' } }), 'b');
    assert.equal(extractToken({ query: { token: 'q' } }), 'q');
  });

  it('ownsPipelineSession isolates by userId', () => {
    const session = { userId: 'u1' };
    assert.equal(ownsPipelineSession(session, { id: 'u1' }), true);
    assert.equal(ownsPipelineSession(session, { id: 'u2' }), false);
    assert.equal(ownsPipelineSession({ userId: LEGACY_USER_ID }, { legacy: true, id: LEGACY_USER_ID }), true);
  });
});
