import test from "node:test";
import assert from "node:assert/strict";

import { RelayDropDO } from "../src/index.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }

  async get(key) {
    await Promise.resolve();
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async put(key, value) {
    await Promise.resolve();
    this.values.set(key, structuredClone(value));
  }

  async deleteAll() {
    await Promise.resolve();
    this.values.clear();
  }

  async setAlarm(timestamp) {
    await Promise.resolve();
    this.alarmAt = timestamp;
  }

  async deleteAlarm() {
    await Promise.resolve();
    this.alarmAt = null;
  }
}

class MemoryState {
  constructor() {
    this.storage = new MemoryStorage();
    this.tail = Promise.resolve();
  }

  blockConcurrencyWhile(callback) {
    const current = this.tail.then(callback);
    this.tail = current.catch(() => undefined);
    return current;
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeRequest(method, token, body) {
  const headers = new Headers();
  if (token !== undefined) headers.set("x-relay-token", token);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://relay.internal/drop", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedDrop(instance, options = {}) {
  const token = options.token || "valid-fetch-token";
  const deleteToken = options.deleteToken || "valid-delete-token";
  const payload = {
    nonce: "nonce-value",
    ciphertext: "encrypted-payload",
    tokenHash: await sha256Hex(token),
    deleteTokenHash: await sha256Hex(deleteToken),
    ttlSecs: options.ttlSecs ?? 180,
    maxDownloads: options.maxDownloads ?? 3,
  };
  const response = await instance.fetch(makeRequest("POST", undefined, payload));
  return { response, token, deleteToken };
}

test("rejects malformed or invalid internal POST payloads", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);

  const malformed = await instance.fetch(
    new Request("https://relay.internal/drop", { method: "POST", body: "{" })
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_json" });

  const invalid = await instance.fetch(
    makeRequest("POST", undefined, {
      nonce: "nonce",
      ciphertext: "ciphertext",
      tokenHash: "not-a-sha256",
      deleteTokenHash: "also-invalid",
    })
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_fields" });
});

test("serializes concurrent fetches and never exceeds maxDownloads", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance, { maxDownloads: 3 });
  assert.equal(seeded.response.status, 201);

  const responses = await Promise.all(
    Array.from({ length: 8 }, () => instance.fetch(makeRequest("GET", seeded.token)))
  );

  assert.equal(responses.filter((response) => response.status === 200).length, 3);
  assert.equal(responses.filter((response) => response.status === 404).length, 5);
  assert.equal(state.storage.values.has("drop"), false);
  assert.equal(state.storage.alarmAt, null);
});

test("locks a drop after five invalid fetch tokens", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await instance.fetch(makeRequest("GET", "incorrect-token"));
    assert.equal(response.status, 403);
  }

  const afterLockout = await instance.fetch(makeRequest("GET", seeded.token));
  assert.equal(afterLockout.status, 404);
  assert.equal(state.storage.values.has("drop"), false);
  assert.equal(state.storage.alarmAt, null);
});

test("only the delete token can destroy a live drop", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance);

  const denied = await instance.fetch(makeRequest("DELETE", "incorrect-delete-token"));
  assert.equal(denied.status, 403);
  assert.equal(state.storage.values.has("drop"), true);

  const deleted = await instance.fetch(makeRequest("DELETE", seeded.deleteToken));
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });
  assert.equal(state.storage.values.has("drop"), false);
  assert.equal(state.storage.alarmAt, null);
});
