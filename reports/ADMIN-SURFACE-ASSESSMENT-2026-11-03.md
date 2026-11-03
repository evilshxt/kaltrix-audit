# Admin Surface Assessment — KaltrixOS

**Date:** 2026-11-03  
**Objective:** Determine whether an unauthenticated or lower-privileged authenticated user can reach admin-only functionality or database data without admin credentials.  
**Classification:** Client Deliverable — Redacted

---

## Executive Summary

No admin compromise path was confirmed through the tested external vectors. The `/admin` route is an authenticated redirect to `/dashboard`; unauthenticated requests are redirected to `/login`. `/dashboard/admin` does not resolve for an authenticated test user (404), and `/api/admin` is absent.

The test account has `profiles.role = "business"`, no admin claims in its JWT, and cannot update its own role. The known Next.js middleware-bypass payloads and common header-spoofing variants did not bypass the authentication redirect.

**Result:** Negative for the tested external vectors. This does not prove that no admin functionality exists internally; the PostgREST OpenAPI schema is not exposed, so the database schema could not be enumerated exhaustively.

---

## Test Summary

### Phase 1 — Admin Route Reconfirmation

Authenticated checks used a valid `@supabase/ssr` cookie constructed from the authorized test session. The cookie was validated by a `200` response from `/dashboard`; the earlier raw-bearer-token experiment was not a valid Next.js session and is not used as evidence.

| Route | Unauthenticated | Authenticated test user | Finding |
|---|---|---|---|
| `/admin` | `307` → `/login` | `307` → `/dashboard` | Authenticated alias to the normal dashboard |
| `/dashboard/admin` | `307` → `/login` | `404` | No admin route |
| `/dashboard` | `307` → `/login` | `200` | Normal dashboard |
| `/api/admin` | `404` | `404` | Does not exist |
| `/_next/data/dashboard/admin.json` | `307` → `/_next/data/dashboard/login.json` | `307` → `/_next/data/dashboard/dashboard.json` | Catch-all redirect; no admin data |

**robots.txt:** Disallows `/dashboard`, `/admin`, and `/invoice`.  
**sitemap.xml:** Lists only public routes (`/`, `/discover`, `/signup`, `/login`, `/business/*`).  
**Route/HTML review:** The downloaded `/admin` HTML is the login page; the authenticated route resolves to the normal dashboard. No separate admin UI was found in the tested surface.

### Phase 2 — Middleware Bypass

No session cookie was sent. A successful bypass would have to reach `/dashboard` or `/admin` without authentication.

| Test | Result |
|---|---|
| CVE-2025-29927 `middleware` ×5 | `307` → `/login` |
| CVE-2025-29927 `src/middleware` ×5 | `307` → `/login` |
| CVE-2025-29927 `pages/_middleware` ×5 | `307` → `/login` |
| Single `middleware` / `src/middleware` segment | `307` → `/login` |
| `x-middleware-rewrite`, `x-original-url`, `x-rewrite-url` | `307` → `/login` |

**Finding:** No middleware bypass was found in the tested variants.

### Phase 3 — JWT and Role Claims

- JWT auth role: `authenticated`.
- `app_metadata`: email provider only.
- `user_metadata`: standard Supabase fields only; values are redacted in this report.
- No `admin`, `superadmin`, `is_admin`, or equivalent claim is present.
- Database `profiles.role`: `business`.
- Self-update to `admin`: `403 permission denied`.
- Self-update to `superadmin`: `403 permission denied`.
- Profiles visible to the test account: one row (own profile).
- Anonymous profile role read: `200 []`.

**Finding:** Role escalation was blocked on the tested path.

### Phase 4 — Database Admin Surface

**Tested admin-like table names (anon and authenticated):**

`admin_users`, `admin_logs`, `admin_settings`, `permissions`, `roles`, `audit_logs`, `system_config`.

All returned `404` with `PGRST205` (“Could not find the table … in the schema cache”). This means those names are not in the exposed schema cache; it is not a complete schema inventory.

**Admin-like columns in known tables:** only `profiles.role` returned data. The tested `is_admin`, `admin_notes`, `approved_by`, `approved_at`, `suspended_at`, and `suspended_by` queries returned no rows or errors. Most business-scoped tables were empty, so this is not a complete column inventory.

**PostgREST OpenAPI:** `/rest/v1/` returned `401` for both anon and authenticated requests. The schema is not exposed, so table/RPC enumeration was limited to names discovered in bundles and guessed names.

**GraphQL:** `/graphql/v1` returns `200` with `{"errors":[{"message":"pg_graphql extension is not enabled."}]}`.

**Admin-like RPCs:** Guessed RPC names were not invoked to avoid side effects. The OpenAPI schema was unavailable, so admin RPCs were not exhaustively enumerated.

**Finding:** No admin-only table or admin privilege column (such as `is_admin`) was confirmed. `profiles.role` exists, but self-updates were denied. The database admin surface was not exhaustively enumerable.

### Phase 5 — Secret Leakage

Searches of the locally stored client bundles found no:

- `service_role` or `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- Paystack secret keys (`sk_test_`, `sk_live_`)
- Private keys or payment-provider private material

Source maps were not downloaded, so deeper source-level review remains a limitation.

**Finding:** No privileged secret was found in the searched bundles.

---

## Controls That Held

1. **Route protection:** `/admin` requires authentication and redirects authenticated users to `/dashboard`; `/dashboard/admin` is not a route.
2. **Middleware:** The tested CVE-2025-29927 payloads and header-spoofing variants did not bypass authentication.
3. **Role enforcement:** `profiles.role` cannot be self-updated to `admin` or `superadmin`.
4. **Row-level security:** Profile reads are scoped to the test account’s own row.
5. **Schema exposure:** PostgREST OpenAPI is not exposed; GraphQL is not enabled.
6. **Secret management:** No privileged secret was found in the searched client bundles.

---

## Limitations

1. **No admin credentials:** The assessment cannot verify what admin functionality, if any, exists server-side.
2. **OpenAPI not exposed:** The database schema and RPC list could not be enumerated exhaustively; absence of guessed names is not proof of absence.
3. **Single test account:** Cross-tenant role behavior was tested against visible rows only. No second confirmed account or synthetic signup account was used.
4. **No signup metadata injection test:** Email confirmation prevents a second account without mailbox access.
5. **No source-map review:** Source maps were not downloaded for deeper secret or route analysis.
6. **Manual SSR cookie:** The authenticated route check used a constructed `@supabase/ssr` cookie, validated by `/dashboard` returning `200`; full browser automation was not used.
7. **No live payment:** Paystack webhook validation remains untested; KAL-BL-001 remains potential.

---

## Conclusion

The tested external vectors do not expose an admin interface. `/admin` is an authentication-gated redirect to the normal dashboard, `/dashboard/admin` is absent, role self-escalation is denied, and the known middleware-bypass payloads failed.

This is a negative result, not a guarantee that no admin capability exists. If an internal admin interface exists, verify that it enforces server-side role checks, uses service-role or database-level permissions for privileged operations, and writes audit logs for privileged actions.

---

## Evidence

| Script | Output |
|---|---|
| `scripts/admin-surface-probe.js` | `evidence/admin-surface-probe.txt` |
| `scripts/admin-db-probe.js` | `evidence/admin-db-probe.txt` |
| `scripts/role-escalation-probe.js` | `evidence/role-escalation-probe.txt` |
| `scripts/middleware-bypass-probe.js` | `evidence/middleware-bypass-probe.txt` |
| `scripts/comprehensive-db-probe.js` | `evidence/comprehensive-db-probe.txt` |
| `scripts/jwt-decode.js` | `evidence/jwt-decode.txt` |

---

## Reproduction

```powershell
cd reports
node scripts/login.js
node scripts/admin-surface-probe.js
node scripts/admin-db-probe.js
node scripts/role-escalation-probe.js
node scripts/middleware-bypass-probe.js
node scripts/comprehensive-db-probe.js
node scripts/jwt-decode.js
```

`role-escalation-probe.js` performs two denied `PATCH` attempts on the authorized test account only; it verifies that the role remains `business`. Do not run it against another account or tenant.
