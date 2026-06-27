import assert from 'node:assert/strict';
import { isExcluded } from '../scripts/sync.mjs';

assert.equal(isExcluded('node_modules'), true);
assert.equal(isExcluded('public/json'), true);
assert.equal(isExcluded('test'), true);
assert.equal(isExcluded('server.mjs'), false);
assert.equal(isExcluded('public/js/ui/devices.mjs'), false);
assert.equal(isExcluded('npm-debug.log'), true);
assert.equal(isExcluded('session.cookie'), true);
assert.equal(isExcluded('Thumbs.db'), true);

console.log('Todos los tests de sync pasaron ✅');
