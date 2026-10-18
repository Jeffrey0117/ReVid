import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl } from './syncConfig.js';

test('normalizeBaseUrl accepts https and strips trailing slashes', () => {
  assert.equal(normalizeBaseUrl(' https://sync.example.com/ '), 'https://sync.example.com');
  assert.equal(normalizeBaseUrl('https://example.com/revid//'), 'https://example.com/revid');
});

test('normalizeBaseUrl allows plain http only for this machine', () => {
  assert.equal(normalizeBaseUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeBaseUrl('http://sync.example.com'), null);
});

test('normalizeBaseUrl rejects junk and other schemes', () => {
  assert.equal(normalizeBaseUrl(''), null);
  assert.equal(normalizeBaseUrl('not a url'), null);
  assert.equal(normalizeBaseUrl('ftp://example.com'), null);
  assert.equal(normalizeBaseUrl('file:///C:/x'), null);
});
