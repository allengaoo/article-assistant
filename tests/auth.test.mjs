import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized, extractToken } from '../webapp/lib/auth.mjs';

describe('auth', () => {
  it('accepts matching token', () => {
    assert.equal(isAuthorized('secret', 'secret'), true);
  });

  it('rejects wrong token when configured', () => {
    assert.equal(isAuthorized('wrong', 'secret'), false);
  });

  it('allows any token when ACCESS_TOKEN unset', () => {
    assert.equal(isAuthorized(undefined, ''), true);
    assert.equal(isAuthorized('anything', ''), true);
  });

  it('extracts token from headers, body, or query', () => {
    assert.equal(extractToken({ headers: { 'x-access-token': 'h' } }), 'h');
    assert.equal(extractToken({ body: { token: 'b' } }), 'b');
    assert.equal(extractToken({ query: { token: 'q' } }), 'q');
  });
});
