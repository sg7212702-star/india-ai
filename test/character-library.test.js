import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalCharacterStore,
  normalizeCharacter,
  normalizeCharacterList,
  validateCharacterPhoto,
  MAX_CHARACTERS_PER_PROJECT,
  MAX_CHARACTER_PHOTO_BYTES
} from "../public/character-library.js";

class FakeRequest {}

class FakeTransaction {
  constructor(records) { this.records = records; }
  objectStore() {
    const records = this.records;
    const transaction = this;
    return {
      put(record) {
        const request = new FakeRequest();
        queueMicrotask(() => {
          records.set(record.key, record);
          request.result = record.key;
          request.onsuccess?.();
          transaction.oncomplete?.();
        });
        return request;
      },
      get(key) {
        const request = new FakeRequest();
        queueMicrotask(() => {
          request.result = records.get(key);
          request.onsuccess?.();
          transaction.oncomplete?.();
        });
        return request;
      },
      delete(key) {
        const request = new FakeRequest();
        queueMicrotask(() => {
          records.delete(key);
          request.result = undefined;
          request.onsuccess?.();
          transaction.oncomplete?.();
        });
        return request;
      }
    };
  }
}

function makeFakeIndexedDB() {
  const records = new Map();
  let database;
  return {
    open() {
      const request = new FakeRequest();
      queueMicrotask(() => {
        if (!database) {
          const stores = new Set();
          database = {
            objectStoreNames: { contains: (name) => stores.has(name) },
            createObjectStore: (name) => { stores.add(name); return {}; },
            transaction: () => new FakeTransaction(records),
            close() {}
          };
          request.result = database;
          request.onupgradeneeded?.();
        } else request.result = database;
        request.onsuccess?.();
      });
      return request;
    }
  };
}

const png = () => new Blob(["character-image"], { type: "image/png" });

test("normalizes a character bible entry and bounds user text", () => {
  const character = normalizeCharacter({
    id: "char-1",
    name: "  Dadaji  ",
    role: "Main character",
    visualDescription: "  Elderly Indian man   in a white kurta.  ",
    photoName: "C:\\Users\\me\\dadaji.png"
  });
  assert.deepEqual(character, {
    id: "char-1",
    name: "Dadaji",
    role: "Main character",
    visualDescription: "Elderly Indian man in a white kurta.",
    photoName: "dadaji.png"
  });
});

test("requires a name and rejects invalid character IDs", () => {
  assert.throws(() => normalizeCharacter({ name: " " }), /Enter a name/);
  assert.throws(() => normalizeCharacter({ id: "../unsafe", name: "Hero" }), /Character ID is invalid/);
});

test("allows an empty character list and caps a project at eight characters", () => {
  assert.deepEqual(normalizeCharacterList(undefined), []);
  const list = Array.from({ length: MAX_CHARACTERS_PER_PROJECT + 1 }, (_, index) => ({
    id: `char-${index}`,
    name: `Character ${index}`
  }));
  assert.throws(() => normalizeCharacterList(list), /at most 8 characters/);
});

test("rejects duplicate character IDs", () => {
  assert.throws(() => normalizeCharacterList([
    { id: "char-same", name: "Hero" },
    { id: "char-same", name: "Villain" }
  ]), /must be unique/);
});

test("accepts JPG, PNG and WebP and rejects unsupported or oversized photos", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.deepEqual(validateCharacterPhoto(new Blob(["x"], { type })), { ok: true });
  }
  assert.match(validateCharacterPhoto(new Blob(["x"], { type: "image/gif" })).error, /JPG, PNG or WebP/);
  assert.match(validateCharacterPhoto(new Blob([], { type: "image/png" })).error, /empty or invalid/);
  assert.match(validateCharacterPhoto({ type: "image/png", size: MAX_CHARACTER_PHOTO_BYTES + 1 }).error, /8 MB or smaller/);
});

test("stores and restores each character photo in its project scope", async () => {
  const store = createLocalCharacterStore({
    indexedDB: makeFakeIndexedDB(),
    now: () => new Date("2026-11-25T04:00:00.000Z")
  });
  await store.save("draft-1", "char-dadaji", png(), "dadaji.png");
  await store.save("draft-2", "char-dadaji", new Blob(["other"], { type: "image/png" }), "other.png");

  const first = await store.get("draft-1", "char-dadaji");
  const second = await store.get("draft-2", "char-dadaji");
  assert.equal(first.name, "dadaji.png");
  assert.equal(first.blob.size, png().size);
  assert.equal(second.name, "other.png");
  assert.equal("url" in first, false);
});

test("removes one character photo without deleting another character", async () => {
  const store = createLocalCharacterStore({ indexedDB: makeFakeIndexedDB() });
  await store.save("draft-1", "char-a", png(), "a.png");
  await store.save("draft-1", "char-b", png(), "b.png");
  await store.remove("draft-1", "char-a");
  assert.equal(await store.get("draft-1", "char-a"), null);
  assert.equal((await store.get("draft-1", "char-b")).name, "b.png");
});

test("rejects unsafe project/character IDs and works without IndexedDB for text-only use", async () => {
  const store = createLocalCharacterStore({ indexedDB: null });
  await assert.rejects(store.get("draft-1", "bad/id"), /valid project ID and character ID/);
  await assert.rejects(store.save("draft-1", "char-1", png(), "hero.png"), /does not support local character photo storage/);
});
