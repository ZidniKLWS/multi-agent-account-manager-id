const MAX_BODY_BYTES = 2 * 1024 * 1024;
const HEX_ID_RE = /^[a-f0-9]{24,64}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: BASE_HEADERS,
  });
}

async function sha256Hex(raw) {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export class RelayDropDO {
  constructor(state) {
    this.state = state;
  }

  async alarm() {
    // Keep expiry cleanup ordered with fetch operations for this drop.
    await this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
    });
  }

  async fetch(request) {
    // Durable Object handlers can interleave at await points. Serialize the
    // read/verify/consume sequence so concurrent GETs cannot exceed the limit.
    return this.state.blockConcurrencyWhile(() => this.handleRequest(request));
  }

  async handleRequest(request) {
    const method = request.method;

    if (method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return jsonResp(400, { error: "invalid_json" });
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        typeof payload.nonce !== "string" ||
        payload.nonce.length === 0 ||
        payload.nonce.length > 64 ||
        typeof payload.ciphertext !== "string" ||
        payload.ciphertext.length === 0 ||
        new TextEncoder().encode(payload.ciphertext).length > MAX_BODY_BYTES ||
        typeof payload.tokenHash !== "string" ||
        !SHA256_HEX_RE.test(payload.tokenHash) ||
        typeof payload.deleteTokenHash !== "string" ||
        !SHA256_HEX_RE.test(payload.deleteTokenHash)
      ) {
        return jsonResp(400, { error: "invalid_fields" });
      }

      const existing = await this.state.storage.get("drop");
      if (existing && Date.now() < existing.expiresAtMs) {
        return jsonResp(409, { error: "already_exists" });
      }

      // A stale record may remain until its alarm runs. Remove it before
      // reusing the same Durable Object ID so an old alarm cannot delete a
      // newly-created drop.
      if (existing) {
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
      }

      const rawTtl = Number.isFinite(payload.ttlSecs) ? Math.trunc(payload.ttlSecs) : 180;
      const rawMax = Number.isFinite(payload.maxDownloads) ? Math.trunc(payload.maxDownloads) : 3;
      const ttlSecs = Math.min(300, Math.max(30, rawTtl));
      const maxDownloads = Math.min(3, Math.max(1, rawMax));
      const expiresAtMs = Date.now() + ttlSecs * 1000;

      const drop = {
        nonce: payload.nonce,
        ciphertext: payload.ciphertext,
        tokenHash: payload.tokenHash,
        deleteTokenHash: payload.deleteTokenHash,
        remaining: maxDownloads,
        badAttempts: 0,
        expiresAtMs,
      };

      await this.state.storage.put("drop", drop);
      await this.state.storage.setAlarm(expiresAtMs);
      return jsonResp(201, { ok: true, expiresAtMs });
    }

    if (method === "GET") {
      const drop = await this.state.storage.get("drop");
      if (!drop || Date.now() >= drop.expiresAtMs) {
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
        return jsonResp(404, { error: "not_found" });
      }

      const token = (request.headers.get("x-relay-token") || "").trim();
      if (!token || token.length > 256) {
        return jsonResp(403, { error: "forbidden" });
      }

      const gotHash = await sha256Hex(token);
      if (!timingSafeEqualHex(gotHash, drop.tokenHash)) {
        drop.badAttempts += 1;
        if (drop.badAttempts >= 5) {
          await this.state.storage.deleteAll();
          await this.state.storage.deleteAlarm();
        } else {
          await this.state.storage.put("drop", drop);
        }
        return jsonResp(403, { error: "forbidden" });
      }

      // This decrement and deletion are protected by blockConcurrencyWhile
      // in fetch(), so each successful response consumes exactly one slot.
      const remaining = drop.remaining - 1;
      const out = { nonce: drop.nonce, ciphertext: drop.ciphertext };
      if (remaining <= 0) {
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
      } else {
        drop.remaining = remaining;
        await this.state.storage.put("drop", drop);
      }
      return jsonResp(200, out);
    }

    if (method === "DELETE") {
      const drop = await this.state.storage.get("drop");
      if (!drop || Date.now() >= drop.expiresAtMs) {
        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
        return jsonResp(404, { error: "not_found" });
      }

      const token = (request.headers.get("x-relay-token") || "").trim();
      if (!token || token.length > 256) {
        return jsonResp(403, { error: "forbidden" });
      }

      const gotHash = await sha256Hex(token);
      if (!timingSafeEqualHex(gotHash, drop.deleteTokenHash)) {
        return jsonResp(403, { error: "forbidden" });
      }

      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return jsonResp(200, { deleted: true });
    }

    return jsonResp(405, { error: "method_not_allowed" });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return jsonResp(200, { ok: true });
    }

    if (request.method === "POST" && path === "/v1/drop") {
      const contentLen = Number(request.headers.get("content-length") || "0");
      if (contentLen > MAX_BODY_BYTES) {
        return jsonResp(413, { error: "payload_too_large" });
      }
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
        return jsonResp(413, { error: "payload_too_large" });
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return jsonResp(400, { error: "invalid_json" });
      }
      if (
        !data ||
        typeof data.id !== "string" ||
        !HEX_ID_RE.test(data.id) ||
        typeof data.nonce !== "string" ||
        data.nonce.length === 0 ||
        data.nonce.length > 64 ||
        typeof data.ciphertext !== "string" ||
        data.ciphertext.length === 0 ||
        data.ciphertext.length > MAX_BODY_BYTES ||
        typeof data.tokenHash !== "string" ||
        !SHA256_HEX_RE.test(data.tokenHash) ||
        typeof data.deleteTokenHash !== "string" ||
        !SHA256_HEX_RE.test(data.deleteTokenHash)
      ) {
        return jsonResp(400, { error: "invalid_fields" });
      }
      const rawTtl = Number.isFinite(data.ttlSecs) ? Math.trunc(data.ttlSecs) : 180;
      const rawMax = Number.isFinite(data.maxDownloads) ? Math.trunc(data.maxDownloads) : 3;
      const ttlSecs = Math.min(300, Math.max(30, rawTtl));
      const maxDownloads = Math.min(3, Math.max(1, rawMax));
      const stub = env.RELAY_DROPS.get(env.RELAY_DROPS.idFromName(data.id));
      return stub.fetch("https://relay.internal/drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: data.nonce,
          ciphertext: data.ciphertext,
          tokenHash: data.tokenHash,
          deleteTokenHash: data.deleteTokenHash,
          ttlSecs,
          maxDownloads,
        }),
      });
    }

    if (path.startsWith("/v1/drop/") && (request.method === "GET" || request.method === "DELETE")) {
      const id = path.slice("/v1/drop/".length);
      if (!HEX_ID_RE.test(id)) {
        return jsonResp(400, { error: "invalid_id" });
      }
      const token = (request.headers.get("x-relay-token") || "").trim();
      if (!token || token.length > 256) {
        return jsonResp(403, { error: "forbidden" });
      }
      const stub = env.RELAY_DROPS.get(env.RELAY_DROPS.idFromName(id));
      return stub.fetch("https://relay.internal/drop", {
        method: request.method,
        headers: { "x-relay-token": token },
      });
    }

    return jsonResp(404, { error: "not_found" });
  },
};
