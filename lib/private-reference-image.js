const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXTENSION = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function decodeReferenceImagePayload({ data, mimeType } = {}) {
  if (typeof mimeType !== 'string' || !MIME_TO_EXTENSION.has(mimeType)) {
    throw inputError('Only JPEG, PNG and WebP reference photos are accepted.', 415);
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw inputError('Provide a base64-encoded reference image.');
  }
  // Reject huge encoded bodies before allocating the decoded Buffer.
  if (data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
    throw inputError('Reference photo exceeds the 5 MiB upload limit.', 413);
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    || (padding === 1 && (data.length - padding) % 4 !== 3)
    || (padding === 2 && (data.length - padding) % 4 !== 2)) {
    throw inputError('Reference photo payload is not valid base64.');
  }

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) throw inputError('Reference photo is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw inputError('Reference photo exceeds the 5 MiB upload limit.', 413);
  }

  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  const matches = (mimeType === 'image/jpeg' && isJpeg)
    || (mimeType === 'image/png' && isPng)
    || (mimeType === 'image/webp' && isWebp);
  if (!matches) {
    throw inputError('Image content does not match the declared JPEG, PNG or WebP type.', 415);
  }

  return { buffer, mimeType, extension: MIME_TO_EXTENSION.get(mimeType), sizeBytes: buffer.length };
}

export function privateReferenceImageObjectPath(uid, assetId, extension) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw inputError('Invalid user ID for reference photo path.');
  }
  if (typeof assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    throw inputError('Invalid reference photo asset ID.');
  }
  if (!['jpg', 'png', 'webp'].includes(extension)) {
    throw inputError('Invalid reference photo extension.');
  }
  return `users/${uid}/references/${assetId}.${extension}`;
}
