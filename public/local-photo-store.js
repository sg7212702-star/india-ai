const DATABASE_NAME = "ai-animation-studio-local-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "referencePhotos";
export const MAX_LOCAL_REFERENCE_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function storageError(message) {
  const error = new Error(message);
  error.code = "LOCAL_PHOTO_STORAGE_ERROR";
  return error;
}

export function validateLocalReferencePhoto(file, maxBytes = MAX_LOCAL_REFERENCE_PHOTO_BYTES) {
  if (!file || typeof file !== "object") return { ok: false, error: "Choose a reference photo first." };
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, error: "Please choose a JPG, PNG or WebP image." };
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return { ok: false, error: "The selected image is empty or invalid." };
  if (file.size > maxBytes) return { ok: false, error: "Image must be " + Math.floor(maxBytes / (1024 * 1024)) + " MB or smaller." };
  return { ok: true };
}

function cleanFileName(value) {
  const name = typeof value === "string" ? value : "reference-photo";
  return name.split(/[\\/]/u).pop().replace(/[\\/:*?"<>|]/gu, "_").slice(0, 180) || "reference-photo";
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || storageError("Could not access local photo storage."));
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || storageError("Local photo storage transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error || storageError("Local photo storage transaction failed."));
  });
}

export function createLocalPhotoStore({ indexedDB = globalThis.indexedDB, now = () => new Date() } = {}) {
  let databasePromise;

  function openDatabase() {
    if (!indexedDB || typeof indexedDB.open !== "function") {
      return Promise.reject(storageError("This browser does not support local photo storage. You can still save a text-only project."));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "draftId" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error || storageError("Could not open local photo storage."));
      request.onblocked = () => reject(storageError("Local photo storage is busy in another tab. Close the other tab and try again."));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  function validateDraftId(draftId) {
    if (typeof draftId !== "string" || !draftId.trim() || draftId.length > 180) {
      throw storageError("A valid project ID is required to store its reference photo.");
    }
  }

  return {
    async save(draftId, blob, fileName) {
      validateDraftId(draftId);
      const validation = validateLocalReferencePhoto(blob);
      if (!validation.ok) throw storageError(validation.error);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completed = transactionResult(transaction);
      const record = {
        draftId,
        blob,
        name: cleanFileName(fileName),
        mimeType: blob.type,
        size: blob.size,
        updatedAt: now().toISOString()
      };
      await Promise.all([requestResult(transaction.objectStore(STORE_NAME).put(record)), completed]);
      return { name: record.name, mimeType: record.mimeType, size: record.size, updatedAt: record.updatedAt };
    },

    async get(draftId) {
      validateDraftId(draftId);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      const completed = transactionResult(transaction);
      const record = await requestResult(transaction.objectStore(STORE_NAME).get(draftId));
      await completed;
      if (!record || !record.blob || record.blob.size !== record.size || record.blob.type !== record.mimeType) return null;
      const validation = validateLocalReferencePhoto(record.blob);
      if (!validation.ok) return null;
      return { blob: record.blob, name: cleanFileName(record.name), mimeType: record.mimeType, size: record.size, updatedAt: record.updatedAt };
    },

    async remove(draftId) {
      validateDraftId(draftId);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completed = transactionResult(transaction);
      await Promise.all([requestResult(transaction.objectStore(STORE_NAME).delete(draftId)), completed]);
    },

    async close() {
      if (!databasePromise) return;
      const database = await databasePromise;
      database.close();
      databasePromise = null;
    }
  };
}
