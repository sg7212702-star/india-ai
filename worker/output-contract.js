function outputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_OUTPUT';
  return error;
}

export function validateWorkerOutput(output, { uid, jobId, request }) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw outputError('The video adapter must return an output object.');
  }
  if (!uid || !jobId || !request) throw new TypeError('Job ownership and request data are required.');

  const assetId = String(output.assetId || '');
  const storagePath = String(output.storagePath || '');
  const mimeType = String(output.mimeType || '');
  const durationSeconds = Number(output.durationSeconds);
  const width = Number(output.width);
  const height = Number(output.height);
  const sizeBytes = Number(output.sizeBytes);
  const aspectRatio = request.aspectRatio === '16:9' ? '16:9' : '9:16';

  if (!/^[A-Za-z0-9_-]{3,128}$/.test(assetId)) {
    throw outputError('The adapter returned an invalid private asset ID.');
  }

  const expectedPrefix = `users/${uid}/jobs/${jobId}/`;
  const pathParts = storagePath.split('/');
  if (!storagePath.startsWith(expectedPrefix)
    || pathParts.some((part) => !part || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(storagePath)) {
    throw outputError('The MP4 must be stored under this user and job in private storage.');
  }

  if (mimeType !== 'video/mp4') throw outputError('The worker output must be a real MP4 file.');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0
    || durationSeconds > 300
    || durationSeconds > Number(request.durationSeconds || 300) + 2) {
    throw outputError('The generated MP4 duration is outside the requested limit.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 64 || height < 64 || width > 8192 || height > 8192) {
    throw outputError('The generated MP4 dimensions are invalid.');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 2_000_000_000) {
    throw outputError('The generated MP4 file size is invalid or exceeds 2 GB.');
  }

  const expectedRatio = aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
  if (Math.abs((width / height) - expectedRatio) > 0.04) {
    throw outputError(`The MP4 dimensions do not match the requested ${aspectRatio} format.`);
  }

  return {
    assetId,
    storagePath,
    mimeType,
    durationSeconds,
    width,
    height,
    sizeBytes,
    aspectRatio
  };
}
