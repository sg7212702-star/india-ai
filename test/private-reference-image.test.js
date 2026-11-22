import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReferenceImagePayload, privateReferenceImageObjectPath } from '../lib/private-reference-image.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const jpeg = [0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9];
function makePng() {
  const bytes = Buffer.alloc(45);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  bytes.write('IEND', 37);
  return [...bytes];
}
function makeWebp() {
  const bytes = Buffer.alloc(22);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8);
  bytes.write('VP8 ', 12);
  bytes.writeUInt32LE(1, 16);
  bytes[20] = 0;
  return [...bytes];
}
const png = makePng();
const webp = makeWebp();

test('accepts a JPEG payload and returns safe metadata', () => {
  const result = decodeReferenceImagePayload({ data: b64(jpeg), mimeType: 'image/jpeg' });
  assert.equal(result.extension, 'jpg');
  assert.equal(result.sizeBytes, jpeg.length);
  assert.deepEqual([...result.buffer], jpeg);
});

test('accepts PNG and WebP signatures', () => {
  assert.equal(decodeReferenceImagePayload({ data: b64(png), mimeType: 'image/png' }).extension, 'png');
  assert.equal(decodeReferenceImagePayload({ data: b64(webp), mimeType: 'image/webp' }).extension, 'webp');
});

test('rejects empty and malformed base64 payloads', () => {
  assert.throws(() => decodeReferenceImagePayload({ data: '', mimeType: 'image/jpeg' }), /base64-encoded/);
  assert.throws(() => decodeReferenceImagePayload({ data: 'not!base64', mimeType: 'image/jpeg' }), /valid base64/);
});

test('rejects unsupported MIME types', () => {
  assert.throws(() => decodeReferenceImagePayload({ data: b64(jpeg), mimeType: 'image/gif' }), { status: 415 });
});

test('rejects content that does not match declared image MIME', () => {
  assert.throws(() => decodeReferenceImagePayload({ data: b64(jpeg), mimeType: 'image/png' }), { status: 415 });
});

test('rejects oversized payloads before and after decode', () => {
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString('base64');
  assert.throws(() => decodeReferenceImagePayload({ data: oversized, mimeType: 'image/jpeg' }), { status: 413 });
});

test('reference object path is scoped to the UID and validates ID and extension', () => {
  const id = '2b9f7d18-19d8-4c30-9aa2-123456789abc';
  assert.equal(privateReferenceImageObjectPath('user_123', id, 'png'), `users/user_123/references/${id}.png`);
  assert.throws(() => privateReferenceImageObjectPath('../bad', id, 'png'));
  assert.throws(() => privateReferenceImageObjectPath('user', 'bad-id', 'png'));
  assert.throws(() => privateReferenceImageObjectPath('user', id, 'gif'));
});
