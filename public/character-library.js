const DATABASE_NAME = "ai-animation-studio-characters-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "characterPhotos";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const MAX_CHARACTERS_PER_PROJECT = 8;
export const MAX_CHARACTER_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_CHARACTER_NAME_LENGTH = 60;
export const MAX_CHARACTER_ROLE_LENGTH = 60;
export const MAX_CHARACTER_DESCRIPTION_LENGTH = 1000;

function libraryError(message) {
  const error = new Error(message);
  error.code = "CHARACTER_LIBRARY_ERROR";
  return error;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\\s+/gu, " ").slice(0, maxLength) : "";
}

function cleanFileName(value) {
  const name = typeof value === "string" ? value : "character-reference";
  return name.split(/[\\\\/]/u).pop().replace(/[\\\\/:*?"<>|]/gu, "_").slice(0, 180) || "character-reference";
}

function validKeyPart(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(value);
}

export function createCharacterId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? "char-" + uuid : "char-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

export function normalizeCharacter(source, { idFactory = createCharacterId } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw libraryError("Each character must be a project character object.");
  }

  const name = cleanText(source.name, MAX_CHARACTER_NAME_LENGTH);
  if (!name) throw libraryError("Enter a name for this character.");

  const id = typeof source.id === "string" && validKeyPart(source.id) ? source.id : idFactory();
  if (!validKeyPart(id)) throw libraryError("Character ID is invalid.");

  return {
    id,
    name,
    role: cleanText(source.role, MAX_CHARACTER_ROLE_LENGTH) || "Character",
    visualDescription: cleanText(source.visualDescription, MAX_CHARACTER_DESCRIPTION_LENGTH),
    photoName: cleanFileName(source.photoName || "")
  };
}

export function normalizeCharacterList(value, options = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw libraryError("Project characters must be a list.");
  if (value.length > MAX_CHARACTERS_PER_PROJECT) {
    throw libraryError(`A project can contain at most ${MAX_CHARACTERS_PER_PROJECT} characters.`);
  }

  const ids = new Set();
  return value.map((item) => {
    const character = normalizeCharacter(item, options);
    if (ids.has(character.id)) throw libraryError("Character IDs must be unique within a project.");
    ids.add(character.id);
    return character;
  });
}

export function validateCharacterPhoto(file, maxBytes = MAX_CHARACTER_PHOTO_BYTES) {
  if (!file || typeof file !== "object") return { ok: false, error: "Choose a character reference photo first." };
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, error: "Choose a JPG, PNG or WebP character photo." };
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return { ok: false, error: "The character photo is empty or invalid." };
  if (file.size > maxBytes) return { ok: false, error: "Character photo must be 8 MB or smaller." };
  return { ok: true };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || libraryError("Could not access local character photo storage."));
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || libraryError("Character photo storage transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error || libraryError("Character photo storage transaction failed."));
  });
}

export function createLocalCharacterStore({ indexedDB = globalThis.indexedDB, now = () => new Date() } = {}) {
  let databasePromise;

  function openDatabase() {
    if (!indexedDB || typeof indexedDB.open !== "function") {
      return Promise.reject(libraryError("This browser does not support local character photo storage. Character descriptions can still be saved."));
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
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error || libraryError("Could not open local character photo storage."));
      request.onblocked = () => reject(libraryError("Character photo storage is busy in another tab. Close the other tab and try again."));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  function validateIds(projectId, characterId) {
    if (!validKeyPart(projectId) || !validKeyPart(characterId)) {
      throw libraryError("A valid project ID and character ID are required.");
    }
  }

  return {
    async save(projectId, characterId, blob, fileName) {
      validateIds(projectId, characterId);
      const validation = validateCharacterPhoto(blob);
      if (!validation.ok) throw libraryError(validation.error);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completed = transactionResult(transaction);
      const record = {
        key: projectId + "::" + characterId,
        projectId,
        characterId,
        blob,
        name: cleanFileName(fileName),
        mimeType: blob.type,
        size: blob.size,
        updatedAt: now().toISOString()
      };
      await Promise.all([requestResult(transaction.objectStore(STORE_NAME).put(record)), completed]);
      return { name: record.name, mimeType: record.mimeType, size: record.size, updatedAt: record.updatedAt };
    },

    async get(projectId, characterId) {
      validateIds(projectId, characterId);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readonly");
      const completed = transactionResult(transaction);
      const record = await requestResult(transaction.objectStore(STORE_NAME).get(projectId + "::" + characterId));
      await completed;
      if (!record || !record.blob || record.blob.size !== record.size || record.blob.type !== record.mimeType) return null;
      const validation = validateCharacterPhoto(record.blob);
      if (!validation.ok) return null;
      return { blob: record.blob, name: cleanFileName(record.name), mimeType: record.mimeType, size: record.size, updatedAt: record.updatedAt };
    },

    async remove(projectId, characterId) {
      validateIds(projectId, characterId);
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completed = transactionResult(transaction);
      await Promise.all([
        requestResult(transaction.objectStore(STORE_NAME).delete(projectId + "::" + characterId)),
        completed
      ]);
    },

    async close() {
      if (!databasePromise) return;
      const database = await databasePromise;
      database.close();
      databasePromise = null;
    }
  };
}
