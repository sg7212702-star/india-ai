const RANGE_ERROR_CODE = 'INVALID_BYTE_RANGE';

function rangeError(message) {
  const error = new Error(message);
  error.code = RANGE_ERROR_CODE;
  error.status = 416;
  return error;
}

function validatePathSegment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TypeError(`Invalid ${label} for private storage path.`);
  }
  return value;
}

export function privateVideoObjectPath(uid, jobId) {
  const safeUid = validatePathSegment(uid, 'user ID');
  const safeJobId = validatePathSegment(jobId, 'job ID');
  return `users/${safeUid}/jobs/${safeJobId}/final.mp4`;
}

/**
 * Parse a single HTTP byte range. Multi-range requests are intentionally unsupported.
 * Returns null when no range is requested, otherwise { start, end, length }.
 */
export function parseVideoByteRange(header, size) {
  if (header == null || header === '') return null;
  if (typeof header !== 'string' || !Number.isSafeInteger(size) || size <= 0) {
    throw rangeError('Invalid byte range request.');
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) {
    throw rangeError('Only one valid byte range is supported.');
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw rangeError('Invalid suffix byte range.');
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end < start || start >= size) {
      throw rangeError('Byte range is not satisfiable.');
    }
    end = Math.min(end, size - 1);
  }

  return { start, end, length: end - start + 1 };
}
