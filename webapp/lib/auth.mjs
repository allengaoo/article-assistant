/**
 * Simple access-token check used by Express middleware and tests.
 */
export function isAuthorized(token, accessToken) {
  if (!accessToken) return true;
  return token === accessToken;
}

export function extractToken(req) {
  if (!req) return undefined;
  if (req.headers && req.headers['x-access-token']) {
    return req.headers['x-access-token'];
  }
  if (req.body && req.body.token) return req.body.token;
  if (req.query && req.query.token) return req.query.token;
  return undefined;
}
