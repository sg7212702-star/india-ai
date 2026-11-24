import test from "node:test";
import assert from "node:assert/strict";
import { createLocalPhotoStore, validateLocalReferencePhoto, MAX_LOCAL_REFERENCE_PHOTO_BYTES } from "../public/local-photo-store.js";

class FakeRequest {}

class FakeTransaction {
  constructor(records) { this.records = records; }
  objectStore() {
    const records = this.records;
    const transaction = this;
    return {
      put(record) {
        const request = new FakeRequest();
        queueMicrotask(() => { records.set(record.draftId, record); request.result = record.draftId; request.onsuccess?.(); transaction.oncomplete?.(); });
        return request;
      },
      get(key) {
        const request = new FakeRequest();
        queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); transaction.oncomplete?.(); });
        return request;
      },
      delete(key) {
        const request = new FakeRequest();
        queueMicrotask(() => { records.delete(key); request.result = undefined; request.onsuccess?.(); transaction.oncomplete?.(); });
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

const png = () => new Blob(["small-image-bytes"], { type: "image/png" });

test("accepts JPEG, PNG and WebP within the local size limit", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.deepEqual(validateLocalReferencePhoto(new Blob(["x"], { type })), { ok: true });
  }
});

test("rejects unsupported, empty and oversized image files", () => {
  assert.match(validateLocalReferencePhoto(new Blob(["x"], { type: "image/gif" })).error, /JPG, PNG or WebP/);
  assert.match(validateLocalReferencePhoto(new Blob([], { type: "image/png" })).error, /empty or invalid/);
  assert.match(validateLocalReferencePhoto({ type: "image/png", size: MAX_LOCAL_REFERENCE_PHOTO_BYTES + 1 }).error, /8 MB or smaller/);
  assert.match(validateLocalReferencePhoto(null).error, /Choose a reference photo/);
});

test("stores and restores a photo by project ID without exposing a public URL", async () => {
  const store = createLocalPhotoStore({ indexedDB: makeFakeIndexedDB(), now: () => new Date("2026-11-24T05:00:00.000Z") });
  const saved = await store.save("draft-1", png(), "C:\\Users\\me\\hero.png");
  assert.equal(saved.name, "hero.png");
  assert.equal(saved.mimeType, "image/png");
  const restored = await store.get("draft-1");
  assert.equal(restored.name, "hero.png");
  assert.equal(restored.blob.type, "image/png");
  assert.equal(restored.size, restored.blob.size);
  assert.equal("url" in restored, false);
});

test("removes a stored photo when its project is deleted or photo is removed", async () => {
  const store = createLocalPhotoStore({ indexedDB: makeFakeIndexedDB() });
  await store.save("draft-2", png(), "hero.png");
  assert.ok(await store.get("draft-2"));
  await store.remove("draft-2");
  assert.equal(await store.get("draft-2"), null);
});

test("rejects invalid project IDs and refuses storage when IndexedDB is unavailable", async () => {
  const store = createLocalPhotoStore({ indexedDB: null });
  await assert.rejects(store.save("draft", png(), "hero.png"), /does not support local photo storage/);
  const supported = createLocalPhotoStore({ indexedDB: makeFakeIndexedDB() });
  await assert.rejects(supported.get(""), /valid project ID/);
});
