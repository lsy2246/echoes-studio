import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { createGitHubAppTokenProvider } from "../../src/runtime/github-app-token";

describe("GitHub App token provider", () => {
  for (const type of ["pkcs1", "pkcs8"] as const) {
    it(`signs an App JWT from a ${type.toUpperCase()} PEM key and caches the installation token`, async () => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const pem = privateKey.export({ type, format: "pem" }).toString();
      let calls = 0;
      const fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
        calls += 1;
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        assert.match(authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
        const claims = JSON.parse(
          Buffer.from(authorization.slice(7).split(".")[1]!, "base64url").toString("utf8"),
        );
        assert.equal(claims.iss, "12345");
        return new Response(JSON.stringify({
          token: "installation-token",
          expires_at: "2026-08-13T01:00:00.000Z",
        }), { status: 201, headers: { "content-type": "application/json" } });
      }) as typeof globalThis.fetch;
      const provider = createGitHubAppTokenProvider({
        appId: "12345",
        installationId: "67890",
        privateKey: pem,
        fetch,
        now: () => Date.parse("2026-08-13T00:00:00.000Z"),
      });

      assert.equal(await provider(), "installation-token");
      assert.equal(await provider(), "installation-token");
      assert.equal(calls, 1);
    });
  }
});
