import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("project builder markup uses unique IDs", () => {
  const ids = [...html.matchAll(/\\bid="([^"]+)"/gu)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test("character library appears exactly once and scene assignment help is present", () => {
  assert.equal((html.match(/id="characterLibrary"/gu) || []).length, 1);
  assert.equal((html.match(/id="characterCount"/gu) || []).length, 1);
  assert.match(html, /scene-character-note/u);
});
