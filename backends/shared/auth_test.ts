import { assertEquals, assertNotEquals } from "@std/assert";
import {
  encodeGrantCookie,
  equalText,
  grantSignature,
  parseGrantCookie,
  verifyGrant,
} from "./auth.ts";

const PASSWORD = "admin-secret";
const OTHER = "other-secret";

Deno.test("grantSignature round-trips for an appspace", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const signed = await grantSignature("Admin", expiresAt, PASSWORD);
  assertEquals(await verifyGrant("Admin", expiresAt, signed, PASSWORD), true);
});

Deno.test("verifyGrant rejects the wrong password", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const signed = await grantSignature("Admin", expiresAt, PASSWORD);
  assertEquals(await verifyGrant("Admin", expiresAt, signed, OTHER), false);
});

Deno.test("verifyGrant rejects an expired grant", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) - 1;
  const signed = await grantSignature("Admin", expiresAt, PASSWORD);
  assertEquals(await verifyGrant("Admin", expiresAt, signed, PASSWORD), false);
});

Deno.test("verifyGrant rejects a signature for a different appspace", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const signed = await grantSignature("Admin", expiresAt, PASSWORD);
  assertEquals(await verifyGrant("local_Apps", expiresAt, signed, PASSWORD), false);
});

Deno.test("equalText is length-independent for mismatches", () => {
  assertEquals(equalText("aa", "aa"), true);
  assertEquals(equalText("aa", "ab"), false);
  assertEquals(equalText("a", "aa"), false);
});

Deno.test("encodeGrantCookie round-trips merged grants", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const admin = await grantSignature("Admin", expiresAt, PASSWORD);
  const other = await grantSignature("Extra", expiresAt, OTHER);
  const token = encodeGrantCookie({
    Admin: [expiresAt, admin],
    Extra: [expiresAt, other],
  });
  const parsed = parseGrantCookie(token);
  assertEquals(parsed?.v, 1);
  assertEquals(parsed?.g.Admin?.[0], expiresAt);
  assertEquals(parsed?.g.Extra?.[1], other);
  assertEquals(
    await verifyGrant("Admin", parsed!.g.Admin![0], parsed!.g.Admin![1], PASSWORD),
    true,
  );
});

Deno.test("removing one grant from a cookie keeps the other", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const admin = await grantSignature("Admin", expiresAt, PASSWORD);
  const extra = await grantSignature("Extra", expiresAt, OTHER);
  const parsed = parseGrantCookie(encodeGrantCookie({
    Admin: [expiresAt, admin],
    Extra: [expiresAt, extra],
  }));
  delete parsed!.g.Admin;
  const kept = parseGrantCookie(encodeGrantCookie(parsed!.g));
  assertEquals(kept?.g.Admin, undefined);
  assertEquals(kept?.g.Extra?.[1], extra);
  assertNotEquals(kept?.g.Extra, undefined);
});

Deno.test("parseGrantCookie rejects junk", () => {
  assertEquals(parseGrantCookie("not-valid"), null);
  assertEquals(parseGrantCookie(""), null);
});
