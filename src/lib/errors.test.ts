import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpError, errorStatus, errorMessage } from './errors.js';

test('httpError tags an Error with a numeric statusCode', () => {
  const err = httpError('nope', 404);
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'nope');
  assert.equal(err.statusCode, 404);
});

test('errorStatus reads the tag, defaults to 500 for anything untagged', () => {
  assert.equal(errorStatus(httpError('x', 403)), 403);
  assert.equal(errorStatus(new Error('plain')), 500);
  assert.equal(errorStatus('a string'), 500);
  assert.equal(errorStatus(undefined), 500);
});

test('errorMessage returns the Error message, or a placeholder for non-Errors', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage(httpError('bad request', 400)), 'bad request');
  assert.equal(errorMessage('nope'), 'Unknown error');
  assert.equal(errorMessage(null), 'Unknown error');
});
