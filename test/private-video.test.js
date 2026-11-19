import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoByteRange, privateVideoObjectPath } from '../lib/private-video.js';

test('derives an owner-scoped private MP4 path', () => {
  assert.equal(
    privateVideoObjectPath('user_123', 'job-abc'),
    'users/user_123/jobs/job-abc/final.mp4'
  );
});

test('rejects path traversal and unsafe path segments', () => {
  assert.throws(() => privateVideoObjectPath('../owner', 'job-123'), /Invalid user ID/);
  assert.throws(() => privateVideoObjectPath('owner', 'job/123'), /Invalid job ID/);
});

test('no range returns null', () => {
  assert.equal(parseVideoByteRange(undefined, 100), null);
  assert.equal(parseVideoByteRange('', 100), null);
});

test('parses bounded and open-ended ranges', () => {
  assert.deepEqual(parseVideoByteRange('bytes=10-19', 100), { start: 10, end: 19, length: 10 });
  assert.deepEqual(parseVideoByteRange('bytes=90-', 100), { start: 90, end: 99, length: 10 });
});

test('clamps end and supports suffix ranges', () => {
  assert.deepEqual(parseVideoByteRange('bytes=95-200', 100), { start: 95, end: 99, length: 5 });
  assert.deepEqual(parseVideoByteRange('bytes=-12', 100), { start: 88, end: 99, length: 12 });
  assert.deepEqual(parseVideoByteRange('bytes=-150', 100), { start: 0, end: 99, length: 100 });
});

test('rejects malformed, multiple, zero suffix and unsatisfiable ranges', () => {
  for (const value of ['bytes=', 'bytes=5-3', 'bytes=100-', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-2']) {
    assert.throws(() => parseVideoByteRange(value, 100), { code: 'INVALID_BYTE_RANGE', status: 416 });
  }
});
