import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { OidcManager, oidcConfigFromEnvironment } from "./oidc.js";

type MockOptions = {
  issuerClaim?: string;
  audience?: string;
  expired?: boolean;
  nonce?: string;
};
const servers: Server[] = [];

async function mockIssuer(options: MockOptions = {}) {
  const keys = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keys.publicKey);
  Object.assign(publicJwk, { kid: "mock", alg: "RS256", use: "sig" });
  let origin = "";
  let expectedChallenge = "";
  let expectedNonce = "";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/.well-known/openid-configuration")
      return void response.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          jwks_uri: `${origin}/jwks`,
          end_session_endpoint: `${origin}/logout`,
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    if (url.pathname === "/jwks")
      return void response.end(JSON.stringify({ keys: [publicJwk] }));
    if (url.pathname === "/token") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const verifier = body.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (challenge !== expectedChallenge) {
        response.statusCode = 400;
        return void response.end(JSON.stringify({ error: "invalid_grant" }));
      }
      const now = Math.floor(Date.now() / 1000);
      const token = await tokenFor(
        keys.privateKey,
        origin,
        options,
        expectedNonce,
        now,
      );
      response.setHeader("content-type", "application/json");
      return void response.end(
        JSON.stringify({
          access_token: "opaque-server-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: token,
        }),
      );
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock issuer failed");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    remember(url: URL) {
      expectedChallenge = url.searchParams.get("code_challenge") ?? "";
      expectedNonce = url.searchParams.get("nonce") ?? "";
    },
  };
}

async function tokenFor(
  key: KeyLike,
  origin: string,
  options: MockOptions,
  expectedNonce: string,
  now: number,
) {
  return new SignJWT({
    nonce: options.nonce ?? expectedNonce,
    name: "OIDC Researcher",
    roles: ["researcher"],
    groups: ["team-a"],
    organization: "lab-a",
  })
    .setProtectedHeader({ alg: "RS256", kid: "mock" })
    .setSubject("user-1")
    .setIssuer(options.issuerClaim ?? origin)
    .setAudience(options.audience ?? "client-1")
    .setIssuedAt(now)
    .setExpirationTime(options.expired ? now - 1 : now + 300)
    .sign(key);
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function settings(origin: string) {
  return oidcConfigFromEnvironment({
    AUTH_MODE: "oidc",
    OIDC_ISSUER: origin,
    OIDC_CLIENT_ID: "client-1",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REDIRECT_URI: "http://127.0.0.1/callback",
    PUBLIC_BASE_URL: "http://127.0.0.1",
  });
}

describe("OIDC Authorization Code + PKCE", () => {
  it("discovers the issuer, uses PKCE/state/nonce, and maps deliberate claims", async () => {
    const mock = await mockIssuer();
    const manager = await OidcManager.discover(settings(mock.origin));
    const authorization = await manager.begin("/studies");
    mock.remember(authorization);
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("state")).toBeTruthy();
    expect(authorization.searchParams.get("nonce")).toBeTruthy();
    const result = await manager.complete(
      new URL(
        `http://127.0.0.1/callback?code=test&state=${authorization.searchParams.get("state")}`,
      ),
    );
    expect(result.returnTo).toBe("/studies");
    expect(result.principal).toMatchObject({
      organizationId: "lab-a",
      roles: ["researcher"],
      teamIds: ["team-a"],
    });
  });

  it("fails closed for state, nonce, issuer, audience, and token expiration", async () => {
    const stateMock = await mockIssuer();
    const stateManager = await OidcManager.discover(settings(stateMock.origin));
    await expect(
      stateManager.complete(
        new URL("http://127.0.0.1/callback?code=x&state=wrong"),
      ),
    ).rejects.toThrow("oidc_state_invalid_or_expired");
    for (const options of [
      { nonce: "wrong" },
      { issuerClaim: "https://wrong.example" },
      { audience: "wrong-client" },
      { expired: true },
    ]) {
      const mock = await mockIssuer(options);
      const manager = await OidcManager.discover(settings(mock.origin));
      const authorization = await manager.begin();
      mock.remember(authorization);
      await expect(
        manager.complete(
          new URL(
            `http://127.0.0.1/callback?code=test&state=${authorization.searchParams.get("state")}`,
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("rejects insecure production issuer and redirect configuration", () => {
    expect(() =>
      oidcConfigFromEnvironment({
        NODE_ENV: "production",
        OIDC_ISSUER: "http://issuer.test",
        OIDC_CLIENT_ID: "client",
        OIDC_REDIRECT_URI: "https://lab.test/callback",
        PUBLIC_BASE_URL: "https://lab.test",
      }),
    ).toThrow("OIDC_ISSUER must use HTTPS");
    expect(() =>
      oidcConfigFromEnvironment({
        NODE_ENV: "production",
        OIDC_ISSUER: "https://issuer.test",
        OIDC_CLIENT_ID: "client",
        OIDC_REDIRECT_URI: "https://other.test/callback",
        PUBLIC_BASE_URL: "https://lab.test",
      }),
    ).toThrow("PUBLIC_BASE_URL origin");
  });
});
