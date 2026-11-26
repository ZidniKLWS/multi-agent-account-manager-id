import test from "node:test";
import assert from "node:assert/strict";

import { RelayDropDO } from "../src/index.js";

class MemoryState {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
    this.tail = Promise.resolve();
    this.storage = {
      get: async (key) => {
        await Promise.resolve();
        const value = this.values.get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (key, value) => {
        await Promise.resolve();
        this.values.set(key, structuredClone(value));
      },
      deleteAll: async () => {
        await Promise.resolve();
        this.values.clear();
      },
      setAlarm: async (timestamp) => {
        await Promise.resolve();
        this.alarmAt = timestamp;
      },
      deleteAlarm: async () => {
        await Promise.resolve();
        this.alarmAt = null;
      },
      transaction: (callback) => this.runExclusive(async () => {
        const draft = new Map(
          [...this.values.entries()].map(([key, value]) => [key, structuredClone(value)])
        );
        const txn = {
          get: async (key) => {
            await Promise.resolve();
            const value = draft.get(key);
            return value === undefined ? undefined : structuredClone(value);
          },
          put: async (key, value) => {
            await Promise.resolve();
            draft.set(key, structuredClone(value));
          },
          delete: async (key) => {
            await Promise.resolve();
            return draft.delete(key);
          },
        };
        const result = await callback(txn);
        this.values = draft;
        return result;
      }),
    };
  }

  runExclusive(callback) {
    const current = this.tail.then(callback);
    this.tail = current.catch(() => undefined);
    return current;
  }

  blockConcurrencyWhile(callback) {
    return this.runExclusive(callback);
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
  assert.equal(state.values.has("drop"), false);
  assert.notEqual(state.alarmAt, null);
});

test("concurrent POST requests cannot replace an existing live drop", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);

  const token = "first-token";
  const secondToken = "second-token";
  const makePayload = async (fetchToken) => ({
    nonce: "nonce-value",
    ciphertext: "encrypted-payload",
    tokenHash: await sha256Hex(fetchToken),
    deleteTokenHash: await sha256Hex("delete-token"),
    ttlSecs: 180,
    maxDownloads: 3,
  });

  const responses = await Promise.all([
    instance.fetch(makeRequest("POST", undefined, await makePayload(token))),
    instance.fetch(makeRequest("POST", undefined, await makePayload(secondToken))),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
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
  assert.equal(state.values.has("drop"), false);
});

test("only the delete token can destroy a live drop", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance);

  const denied = await instance.fetch(makeRequest("DELETE", "incorrect-delete-token"));
  assert.equal(denied.status, 403);
  assert.equal(state.values.has("drop"), true);

  const deleted = await instance.fetch(makeRequest("DELETE", seeded.deleteToken));
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });
  assert.equal(state.values.has("drop"), false);
});

test("an old alarm never deletes a newer drop", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance);
  assert.equal(seeded.response.status, 201);

  const current = state.values.get("drop");
  current.expiresAtMs = Date.now() + 60_000;
  state.values.set("drop", current);
  await instance.alarm();

  assert.equal(state.values.has("drop"), true);
  assert.equal(state.alarmAt, current.expiresAtMs);
});
test("an expired alarm removes the stale drop and alarm", async () => {
  const state = new MemoryState();
  const instance = new RelayDropDO(state);
  const seeded = await seedDrop(instance);
  assert.equal(seeded.response.status, 201);

  const expired = state.values.get("drop");
  expired.expiresAtMs = Date.now() - 1;
  state.values.set("drop", expired);

  await instance.alarm();

  assert.equal(state.values.has("drop"), false);
  assert.equal(state.alarmAt, null);
});

