/**
 * Authorization Rules Unit Tests (pure functions, no network)
 *
 * @example Run tests:
 * deno test supabase/functions/_tests/authorization-rules.unit.test.ts
 */

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CallerIdentity,
  callerInTenant,
  decideSessionAccess,
  parseBearerToken,
  resolveRequestTenant,
} from "../_shared/authorization-rules.ts";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";

const caseworker: CallerIdentity = { userId: U1, tenantIds: [T1], roles: ["caseworker"], profileStatus: "active" };
const supervisor: CallerIdentity = { userId: U2, tenantIds: [T1], roles: ["supervisor"], profileStatus: "active" };
const outsider: CallerIdentity = { userId: U2, tenantIds: [T2], roles: ["caseworker"], profileStatus: "active" };

Deno.test("bearer: accepts a JWT-shaped bearer, case-insensitive scheme", () => {
  assertEquals(parseBearerToken(`Bearer ${JWT}`), JWT);
  assertEquals(parseBearerToken(`bearer   ${JWT}  `), JWT);
});

Deno.test("bearer: rejects missing, non-bearer, and non-JWT values", () => {
  assertStrictEquals(parseBearerToken(null), null);
  assertStrictEquals(parseBearerToken(undefined), null);
  assertStrictEquals(parseBearerToken(""), null);
  assertStrictEquals(parseBearerToken(JWT), null);                 // no scheme
  assertStrictEquals(parseBearerToken("Basic abc"), null);
  assertStrictEquals(parseBearerToken("Bearer not-a-jwt"), null);
  assertStrictEquals(parseBearerToken("Bearer a.b"), null);
  assertStrictEquals(parseBearerToken("Bearer a.b.c d"), null);
});

Deno.test("tenant: membership compare is uuid-only and case-insensitive", () => {
  assertEquals(callerInTenant(caseworker, T1), true);
  assertEquals(callerInTenant(caseworker, T1.toUpperCase()), true);
  assertEquals(callerInTenant(caseworker, T2), false);
  assertEquals(callerInTenant(caseworker, "not-a-uuid"), false);
  assertEquals(callerInTenant(caseworker, null), false);
  assertEquals(callerInTenant({ ...caseworker, tenantIds: [] }, T1), false);
});

Deno.test("session: owner in tenant is allowed", () => {
  const d = decideSessionAccess(caseworker, { id: "s", tenant_id: T1, user_id: U1 });
  assertEquals(d, { allowed: true, tenantId: T1 });
});

Deno.test("session: missing row and foreign tenant both read as not_found", () => {
  assertEquals(decideSessionAccess(caseworker, null), { allowed: false, reason: "not_found" });
  assertEquals(decideSessionAccess(caseworker, undefined), { allowed: false, reason: "not_found" });
  assertEquals(decideSessionAccess(caseworker, { tenant_id: T2, user_id: U1 }), { allowed: false, reason: "not_found" });
  assertEquals(decideSessionAccess(caseworker, { tenant_id: null, user_id: U1 }), { allowed: false, reason: "not_found" });
  assertEquals(decideSessionAccess(outsider, { tenant_id: T1, user_id: U2 }), { allowed: false, reason: "not_found" });
});

Deno.test("session: same-tenant non-owner is forbidden unless supervisor allowed", () => {
  const row = { tenant_id: T1, user_id: U1 };
  assertEquals(decideSessionAccess(supervisor, row), { allowed: false, reason: "forbidden" });
  assertEquals(decideSessionAccess(supervisor, row, { allowSupervisor: true }), { allowed: true, tenantId: T1 });
  const peer: CallerIdentity = { ...caseworker, userId: U2 };
  assertEquals(decideSessionAccess(peer, row, { allowSupervisor: true }), { allowed: false, reason: "forbidden" });
});

Deno.test("session: null owner is never 'owned', supervisor may still act", () => {
  const row = { tenant_id: T1, user_id: null };
  assertEquals(decideSessionAccess(caseworker, row), { allowed: false, reason: "forbidden" });
  assertEquals(decideSessionAccess(supervisor, row, { allowSupervisor: true }), { allowed: true, tenantId: T1 });
});

Deno.test("request tenant: body tenant must be a membership; single membership is implicit", () => {
  assertEquals(resolveRequestTenant(caseworker, T1), { ok: true, tenantId: T1 });
  assertEquals(resolveRequestTenant(caseworker, T1.toUpperCase()), { ok: true, tenantId: T1 });
  assertEquals(resolveRequestTenant(caseworker, T2), { ok: false, reason: "forbidden" });
  assertEquals(resolveRequestTenant(caseworker, undefined), { ok: true, tenantId: T1 });
  assertEquals(resolveRequestTenant(caseworker, ""), { ok: true, tenantId: T1 });
  const multi: CallerIdentity = { ...caseworker, tenantIds: [T1, T2] };
  assertEquals(resolveRequestTenant(multi, undefined), { ok: false, reason: "ambiguous" });
  assertEquals(resolveRequestTenant(multi, T2), { ok: true, tenantId: T2 });
  assertEquals(resolveRequestTenant({ ...caseworker, tenantIds: [] }, T1), { ok: false, reason: "none" });
});
