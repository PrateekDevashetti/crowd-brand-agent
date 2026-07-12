import assert from "node:assert/strict";
import test from "node:test";
import { hasUnsafeDevSecret, isOriginAllowed, parseAllowedOrigins } from "../src/lib/security.js";

test("production CORS fails closed when no allowlist is configured", () => {
  assert.deepEqual(parseAllowedOrigins(undefined, true), []);
  assert.equal(parseAllowedOrigins(undefined, false), null);
});

test("CORS accepts only configured exact origins and non-browser requests", () => {
  const allowed = parseAllowedOrigins(" https://app.trycanopy.space, https://admin.trycanopy.space ", true);
  assert.deepEqual(allowed, ["https://app.trycanopy.space", "https://admin.trycanopy.space"]);
  assert.equal(isOriginAllowed(undefined, allowed), true);
  assert.equal(isOriginAllowed("https://app.trycanopy.space", allowed), true);
  assert.equal(isOriginAllowed("http://app.trycanopy.space", allowed), false);
  assert.equal(isOriginAllowed("https://preview.app.trycanopy.space", allowed), false);
  assert.equal(isOriginAllowed("https://evilapp.trycanopy.space", allowed), false);
});

test("the default development key is rejected only in production", () => {
  assert.equal(hasUnsafeDevSecret(true, "dev-secret"), true);
  assert.equal(hasUnsafeDevSecret(false, "dev-secret"), false);
  assert.equal(hasUnsafeDevSecret(true, "rotated-secret"), false);
});
