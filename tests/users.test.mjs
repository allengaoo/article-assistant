import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb } from '../webapp/lib/db.mjs';
import {
  createUser,
  verifyPassword,
  hashPassword,
  findUserByLogin,
  bootstrapAdminIfEmpty,
  countUsers,
} from '../webapp/lib/users.mjs';

describe('users', () => {
  let dataDir;

  beforeEach(() => {
    closeDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzh-user-test-'));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('hashes and verifies password', () => {
    const hash = hashPassword('secret123');
    assert.equal(verifyPassword('secret123', hash), true);
    assert.equal(verifyPassword('wrong', hash), false);
  });

  it('creates user with unique login name', () => {
    const user = createUser({ loginName: 'alice', password: 'pass1234', role: 'customer' });
    assert.equal(user.loginName, 'alice');
    assert.equal(user.role, 'customer');
    assert.equal(findUserByLogin('Alice').login_name, 'alice');
  });

  it('bootstrapAdminIfEmpty creates first admin', () => {
    assert.equal(countUsers(), 0);
    const admin = bootstrapAdminIfEmpty({ login: 'admin', password: 'admin1234' });
    assert.equal(admin.loginName, 'admin');
    assert.equal(admin.role, 'admin');
    assert.equal(bootstrapAdminIfEmpty({ login: 'x', password: 'y123456' }), null);
  });
});
