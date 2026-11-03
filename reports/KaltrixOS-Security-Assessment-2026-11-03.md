# KaltrixOS — External Security Assessment

**Target:** https://kaltrixos.com/  
**Engagement:** Authorized external web application and backend security assessment  
**Assessment window:** 2026-10-31 to 2026-11-03  
**Classification:** Client Deliverable — Redacted  
**Reference:** `../info.txt`

---

## 1. Executive Summary

KaltrixOS is a Next.js (App Router) application hosted on Vercel with a Supabase backend (Auth, PostgREST, and Postgres). This assessment covered the public application surface, client bundles, Supabase authentication, PostgREST table access, column-level grants, and authenticated cross-tenant behavior.

**One Medium-severity issue is confirmed:** the public PostgREST endpoint exposes business `email` and `address` columns to **unauthenticated** callers through column-specific queries. The same endpoint also lets any authenticated user read internal `user_id` and `trust_signals` columns for every business. The application's own `/discover` query does not request these fields, which indicates the exposure is unintended.

The write/authorization layer held up well in the tests that could be completed: cross-tenant business updates were blocked (0 rows affected), profile role changes were denied, owners could not self-set `is_verified` or `trust_score`, and cross-tenant profile reads returned no rows. Several potential read-scope issues remain unproven because the affected tables were empty.

A captured HAR of the authenticated dashboard exposed two additional tables (`listings`, `expenses`) and two RPCs (`get_business_pulse`, `get_inventory_overview`). Both RPCs reject non-owned business IDs, but `listings` does not: the test account could read three catalog rows belonging to three other businesses. The exposed listing fields are name, description, price, image URL, and active flag — no PII — so this is a Low-severity access-control gap whose impact depends on whether listings are meant to be public. Anonymous callers are denied.

The tier and logo paths were also exercised. A direct owner `PATCH` to `subscriptions.plan` returned the row but did not change the plan, so plan activation remains server-side. Logo uploads require an authenticated owner session, are limited to image MIME types, and are scoped to the caller's user-ID prefix; anonymous uploads were denied. The upgrade page still sends the plan and amount from the browser, so the Paystack webhook's amount/metadata validation is the remaining unverified control (KAL-BL-001).

**Overall posture:** reasonable enforcement of destructive, privilege-changing, storage, and subscription-write operations, but over-broad read grants, column exposure, and unverified payment-webhook validation are the main weaknesses. The most urgent action is to remove anonymous access to business contact columns, then decide and enforce listing visibility and verify the Paystack webhook.

---

## 2. Scope and Methodology

### In scope
- `https://kaltrixos.com/` and its application routes.
- Supabase project `fgkdkyhnokijbxyxcgug` (Auth + PostgREST), reachable with the public anon key shipped in the client bundle.
- Authenticated testing with the authorized test account created for this engagement.

### Testing methods
- Route and asset discovery from the live application and Next.js/Turbopack bundles.
- Static review of client bundles for embedded configuration and API calls.
- Supabase Auth testing: signup, password grant, recovery behavior.
- PostgREST access matrix: anonymous vs authenticated, table-level and column-level.
- Row-level security (RLS) probing: cross-tenant reads, cross-tenant writes, privilege fields.
- Non-destructive write probes: same-value PATCH with `Prefer: return=representation` to distinguish allowed writes from RLS-filtered writes without changing data.
- HAR review of the authenticated dashboard to recover table names, RPC calls, and client-supplied `business_id`/`user_id` parameters.
- Read-only RPC and cross-tenant table probes against sampled tenants.
- Evidence capture with counts and statuses only; no PII values recorded.

### Constraints
- No Supabase `service_role` key was available or used.
- Only one confirmed test account was available (email confirmation required; no mailbox access for a second account).
- The `logos` bucket was tested with the authorized test account; cross-tenant storage overwrite/delete was not attempted.
- `/admin` is an authentication-gated redirect to `/dashboard`; no separate server-side admin interface was found in the tested routes.
- The authenticated dashboard and upgrade flow were reviewed from two captured HARs; live browser automation was not used.
- The Paystack webhook implementation was not available; no live payment was made.
- TLS deep scan, DNS/subdomain enumeration, source-map review, cookie attributes, password-reset token handling, and auth rate limiting were not completed in this pass.

---

## 3. Risk Summary

| ID | Severity | Status | Title |
|---|---|---|---|
| KAL-AC-001 | **Medium** | Confirmed | Business `email`/`address` exposed to anonymous users; `user_id`/`trust_signals` exposed to authenticated users |
| KAL-DC-002 | Low | Confirmed | PostgREST `PGRST205` hints leak internal table names |
| KAL-CF-001 | Low | Confirmed | Missing HTTP security headers |
| KAL-DC-001 | Informational | Confirmed | Supabase URL + anon key embedded in client bundles |
| KAL-DB-001 | Medium (potential) | Potential | Anonymous SELECT allowed on `profiles` and `leads` (empty) |
| KAL-DB-002 | Low (potential) | Potential | Anonymous SELECT allowed on `email_logs` (empty) |
| KAL-DB-003 | Low (potential) | Potential | Authenticated SELECT on multiple business-scoped tables (empty; scope unverified) |
| KAL-DB-004 | Low (potential) | Observation | Authenticated users can read reviews for other businesses; product intent unclear |
| KAL-DB-005 | Low | Confirmed access | Authenticated users can read other businesses' listings (catalog fields only; intent unclear) |
| KAL-BL-001 | Medium (potential) | Potential | Paystack amount/plan metadata is client-controlled; server-side webhook verification not tested |

---

## 4. Confirmed Findings

### 4.1 KAL-AC-001 — Business Contact Columns Exposed to Anonymous Users

**Severity:** Medium  
**CVSS 4.0:** 6.9 — `AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`  
**Affected endpoint:** `https://fgkdkyhnokijbxyxcgug.supabase.co/rest/v1/businesses`  
**Affected component:** `public.businesses` table; PostgREST column privileges / RLS design

#### Description
An unauthenticated caller holding only the public anon key can request the `email` and `address` columns for every row in `public.businesses` (10 rows at test time). The public discover columns are also readable. A blanket `select=*` is denied because `user_id` and `trust_signals` are not granted to `anon`, but column-specific queries bypass that check.

An authenticated user can additionally read `user_id` and `trust_signals`, and `select=*` succeeds for them.

The application's own `/discover` component selects only:
`id, business_name, industry, city, phone, website_url, trust_score, is_verified, slug, logo_url, description`
It does not request `email` or `address`, which supports the conclusion that those columns were over-granted rather than intentionally public.

#### Evidence summary
| Request | Anon | Authenticated |
|---|---|---|
| `businesses?select=id` | `200`, 10 rows | `200`, 10 rows |
| `businesses?select=email` | `200` (3/10 non-empty; one synthetic test-business value added during assessment) | `200` |
| `businesses?select=address` | `200` (2/10 non-empty; one synthetic test-business value added during assessment) | `200` |
| `businesses?select=phone` | `200` (10/10 non-empty) | `200` |
| `businesses?select=user_id` | `401 42501` | `200` |
| `businesses?select=trust_signals` | `401 42501` | `200` |
| `businesses?select=*` | `401 42501` | `200` |

Total row count: `10` (`Content-Range: 0-9/10`), with 10 distinct owner IDs.

No PII values are reproduced in this report. The raw status/count transcript is in `evidence/access-control-probe.txt`. The authorized test business was completed during the assessment with synthetic contact values, a public logo, and slug `kaltrix-labs-assessment`; the non-empty counts above include that synthetic row.

#### Potential impact
- Unauthenticated scraping of business email addresses and physical addresses for every listed business.
- Enables phishing, spam, competitive harvesting, and physical targeting.
- Registration is open, so requiring authentication would still be a low barrier; anonymous access removes even that.
- Authenticated users also obtain internal `user_id` and `trust_signals` values, aiding account correlation and trust-score research.

#### Exploitability
Trivial. No account, interaction, or token is needed beyond the public anon key that the site ships to every browser.

#### Remediation
1. Revoke blanket `SELECT` on `public.businesses` from `anon` and `authenticated`.
2. Grant column-level `SELECT` only for the public discover surface:
   `id, business_name, industry, city, phone, website_url, trust_score, is_verified, slug, logo_url, description`.
3. Do not grant `email`, `address`, `user_id`, or `trust_signals` to `anon`.
4. Expose owner-only columns through an owner-scoped policy (`auth.uid() = user_id`) using a **view** or RPC, not the public table. Column-level grants are not row-conditional.
5. Add regression tests:
   - anon on `email`/`address` → `401`/empty;
   - non-owner authenticated on `user_id`/`trust_signals` → `401`/empty;
   - owner reading their own contact fields succeeds.

Example direction (adapt to your migration tooling):
```sql
REVOKE SELECT ON public.businesses FROM anon, authenticated;
GRANT SELECT (id, business_name, industry, city, phone, website_url,
              trust_score, is_verified, slug, logo_url, description)
  ON public.businesses TO anon, authenticated;
```

---

### 4.2 KAL-DC-002 — PostgREST Hints Reveal Internal Table Names

**Severity:** Low  
**CVSS 4.0:** 2.3  
**Affected endpoint:** `https://fgkdkyhnokijbxyxcgug.supabase.co/rest/v1/*`

Querying a non-existent table returns `PGRST205` with a `hint` field containing the closest existing table name. Repeated probes revealed `customers`, `leads`, `subscriptions`, `profiles`, and later `invoices`, `messages`, `rate_limits`, `inventory_items`, `email_logs`, `bookings`, `business_payment_details`, and `reviews`.

**Impact:** aids targeted discovery of business tables. No direct data exposure.
**Remediation:** move non-public tables out of the PostgREST-exposed `public` schema, or restrict the anon role's schema usage so they do not appear in the schema cache/hints.

---

### 4.3 KAL-CF-001 — Missing HTTP Security Headers

**Severity:** Low  
**CVSS 4.0:** 2.0  
**Affected URL:** `https://kaltrixos.com/` and `/login` (consistent)

Responses lack `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` (or CSP `frame-ancestors`), `Referrer-Policy`, and `Permissions-Policy`. `Strict-Transport-Security` is present (`max-age=63072000`), though without `includeSubDomains`/`preload`.

**Impact:** increased exposure to MIME sniffing, clickjacking, referrer leakage, and capability abuse. Not directly exploitable on its own.
**Remediation:** add a strict CSP (`script-src 'self'` with hashes/nonces; Supabase domains in `connect-src`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` or `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, and a minimal `Permissions-Policy`.

---

### 4.4 KAL-DC-001 — Supabase Public Configuration in Client Bundles

**Severity:** Informational  
**CVSS 4.0:** 0.0

The browser bundle contains the Supabase project URL and anon key. This is publishable-by-design; its security value is that it enables direct PostgREST/Auth testing against the project. No `service_role`, SMTP, payment-provider, or private-key material was found in the downloaded bundles.

**Remediation:** acceptable as-is, provided RLS and column grants are the enforcement layer. Add a CI secret scan to catch accidental private keys. Rotate the anon key if it is ever used with overly broad grants (as in KAL-AC-001).

---

### 4.5 KAL-DB-005 — Authenticated Cross-Tenant Listing Read

**Severity:** Low  
**CVSS 4.0:** 3.1 — `AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`  
**Affected endpoint:** `https://fgkdkyhnokijbxyxcgug.supabase.co/rest/v1/listings`  
**Affected component:** `public.listings` RLS / ownership scoping

#### Description
An authenticated user can read listing rows belonging to other businesses. At test time the authorized test account owned zero listings, yet `GET /rest/v1/listings?select=*` returned three rows across three distinct `business_id` values. Filtering directly by another business ID also returned that business's row.

Readable columns: `id`, `business_id`, `name`, `description`, `price`, `image_url`, `is_active`, `created_at`. Anonymous callers are denied (`401 42501`). No customer PII or payment data is present in the table.

#### Evidence summary
| Request | Auth | Anon |
|---|---|---|
| `listings?select=*` | `200`, 3 rows, 3 distinct businesses, all non-owned | `401 42501` |
| `listings?select=*&business_id=eq.<other>` | `200`, 1 row | `401` |
| `listings?select=*&business_id=eq.<own>` | `200`, 0 rows | `401` |

Column values are omitted from the deliverable; `name`, `description`, and `image_url` are redacted in `database-exports/listings.json`.

#### Impact
Disclosure of other businesses' catalog data, including pricing and the `is_active` flag, which can reveal unpublished or deactivated listings. No customer PII, bank data, or credentials are exposed. The severity is Low because the rows are catalog metadata and the product intent is unclear.

#### Remediation
Decide the intended audience:
- **If listings are public:** grant `anon` SELECT on only the safe display columns and restrict rows to `is_active = true`.
- **If listings are private:** add an RLS policy scoped to the owning business, e.g. `business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid())`, and hide inactive rows from non-owners.
- Add a two-tenant regression test asserting that non-owner reads return `0` rows.

---

## 5. Potential Findings and Observations

### 5.1 KAL-DB-001 — Anonymous SELECT on `profiles` and `leads`
`GET /rest/v1/profiles?select=*` and `/rest/v1/leads?select=*` return `200 []` to anon, while correctly denied tables return `401 42501`. Both tables were empty at test time, so the policy grant is confirmed but data impact is not demonstrated. If populated, anonymous callers could enumerate all anon-visible rows. Recommended: deny anon SELECT; scope profiles to `auth.uid() = id`; scope leads to admins/service role.

### 5.2 KAL-DB-002 — Anonymous SELECT on `email_logs`
`GET /rest/v1/email_logs?select=*` returns `200 []` to anon and authenticated users. The table is empty. Email logs commonly contain recipient addresses, provider IDs, and action links; deny anon access and restrict to service role/admins.

### 5.3 KAL-DB-003 — Authenticated SELECT on Business-Scoped Tables
Any authenticated user can `SELECT` from `customers`, `bookings`, `invoices`, `messages`, `inventory_items`, `expenses`, and `business_payment_details` (all empty at test time). Anon is correctly denied. Cross-tenant filters for these tables returned `0` rows, so ownership scoping is either enforced or simply untestable while empty. `subscriptions` and `profiles` returned only the caller's own row, indicating RLS is implemented for those tables. Cross-tenant row scope for the empty tables remains unproven; re-test once rows exist. `business_payment_details` should be service-role-only regardless. `listings` is handled separately in KAL-DB-005 because it contains rows and returned cross-tenant data.

### 5.4 KAL-DB-004 — Authenticated Review Reads Across Tenants
Authenticated users can read review rows for businesses they do not own. At test time one review existed for another business, and the following columns were readable: `id`, `business_id`, `rating`, `comment`, `reviewer_name`, `created_at`. `reviewer_email` is denied by a column grant. Anonymous users are denied.

Reviews are often public by design, so this may be intentional; however, anon is currently denied, which makes the intended audience unclear. If reviews are meant to be public, grant anon only the safe display columns and expose them intentionally. If they are meant to be private, scope reads by business ownership. Add a product-intent test to the regression suite.

### 5.5 KAL-BL-001 — Client-Controlled Paystack Plan/Amount Metadata
The `/dashboard/upgrade` flow uses Paystack Inline. The browser supplies the transaction `amount` and `currency`, a client-generated `reference`, and `metadata` containing `business_id`, `plan`, `billing`, and the customer name. The callback reviewed does not call a server-side verification endpoint, and no verification call appears in the captured HAR; it polls `subscriptions` until `plan` and `paystack_reference` match the selected plan and reference. Plan activation therefore depends on the server-side Paystack webhook.

A direct owner `PATCH` to `subscriptions.plan` returned `200` with the row but left the plan unchanged, so the direct write path is not open. The webhook implementation was not available to this assessment. If the webhook trusts client-supplied `metadata.plan` without verifying the paid amount, currency, and transaction status, a user could pay a lower-tier amount and receive a higher tier. This was not tested because it requires a live payment and webhook access; treat it as unverified, not confirmed.

**Remediation:** verify every transaction server-side with Paystack (`GET /transaction/verify/:reference`), validate `status`, `amount`, `currency`, and the expected plan price, derive the plan and duration from a server-side price table rather than client metadata, enforce idempotency and webhook signature checks, and keep `subscriptions` writes restricted to the service role. Do not rely on a client-generated reference as proof of payment.

---

## 6. Controls That Held

The following checks produced negative results (the control worked):

- Cross-tenant business `UPDATE` with a same-value PATCH → `200` but **0 rows represented** (RLS filtered the write).
- Owner setting `is_verified=true` / `trust_score=100` → values returned unchanged (not writable by owner).
- `profiles.role` self-update to `admin` → `403 42501`.
- Cross-tenant profile `SELECT` by another owner's `user_id` → `0` rows.
- `subscriptions` → only the caller's own row visible; a cross-tenant `business_id` filter returned `0` rows. A direct owner `PATCH` to `subscriptions.plan` (`pro` → `growth`) returned `200` with the row, but the plan stayed `pro`; the plan write is blocked or reset server-side. `paystack_reference` was not modified.
- `profiles` → only the caller's own row visible; an anon `id`-filtered read returned `0` rows.
- Cross-tenant `business_payment_details`, `expenses`, `bookings`, `customers`, `invoices`, `messages`, and `notifications` → `0` rows (tables empty, so scope is unproven beyond the absence of rows).
- `get_inventory_overview` with a non-owned `p_business_id` → `403 42501 not_authorized`.
- `get_business_pulse` with a non-owned `p_business_id` → `200` with `{ "error": "not_authorized" }` and no business data. The control works, but returning HTTP 200 for a denial is poor API design.
- Anonymous RPC calls (`get_business_pulse`, `get_inventory_overview`) → `401`.
- Anon denied (`401 42501`) on `customers`, `subscriptions`, `bookings`, `invoices`, `messages`, `notifications`, `inventory_items`, `business_payment_details`, `feedback`, `reviews`, `listings`, `expenses`, and `rate_limits`.
- `rate_limits` → `403` to authenticated users.
- Storage `logos` bucket → authenticated owner upload works and the uploaded logo is publicly readable as `image/png`. Non-image MIME types (`text/plain`, `text/html`, `image/svg+xml`) were rejected with `400 mime type ... is not supported`. A path without the caller's user-ID prefix was rejected with `400` RLS denial, and an anonymous upload was rejected with `400` RLS denial. Anonymous and authenticated list calls returned `200` with zero objects (no enumeration of the uploaded object).

---

## 7. Attack Surface

### Application routes
`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/dashboard`, `/dashboard/create-business`, `/dashboard/profile`, `/dashboard/upgrade`, `/dashboard/bookings/new`, `/dashboard/customers/new`, `/dashboard/invoices/new`, `/dashboard/listings/new`, `/dashboard/feedback`, `/discover`, `/feedback`, `/privacy`, `/terms`, `/signup/confirm`, `/admin`, `/invoice/:id`.

The dashboard routes are client-rendered. The client bundle references the Supabase Realtime path `/api/broadcast`; `/api/feedback` now returns `404`.

`/admin` redirects unauthenticated callers to `/login` and authenticated callers to `/dashboard`. `/dashboard/admin` and `/api/admin` return `404`; there is no separate admin route in the tested surface.

### PostgREST access matrix

| Table | Anon | Authenticated |
|---|---|---|
| `businesses` | 200 (public columns + `email` + `address`); `select=*` 401 | 200 all columns; cross-tenant row by `id` confirmed |
| `profiles` | 200 (0 rows) | 200 own row |
| `leads` | 200 (empty) | 200 (empty) |
| `email_logs` | 200 (empty) | 200 (empty) |
| `customers` | 401 | 200 (empty) |
| `subscriptions` | 401 | 200 own row |
| `bookings` | 401 | 200 (empty) |
| `invoices` | 401 | 200 (empty) |
| `messages` | 401 | 200 (empty) |
| `notifications` | 401 | 200 (empty) |
| `inventory_items` | 401 | 200 (empty) |
| `business_payment_details` | 401 | 200 (empty) |
| `feedback` | 401 | 200 (empty) |
| `reviews` | 401 | 200 (1 cross-tenant row) |
| `listings` | 401 | 200 (3 cross-tenant rows) |
| `expenses` | 401 | 200 (empty) |
| `rate_limits` | 401 | 403 |

### PostgREST RPCs

| RPC | Inputs | Own business | Non-owned business | Anon |
|---|---|---|---|---|
| `get_business_pulse` | `p_business_id`, `p_period_days` | 200 (data) | 200 `{error:"not_authorized"}` (no data) | 401 |
| `get_inventory_overview` | `p_business_id`, `p_status`, `p_search`, `p_limit`, `p_offset` | 200 | 403 `42501 not_authorized` | 401 |

The RPCs correctly enforce ownership. `get_business_pulse` should return a `403` instead of `200` with an error body so clients cannot mistake a denial for success.

### Storage

The dashboard uploads business logos directly to the public `logos` bucket as `<user_id>-<timestamp>.<ext>` and stores the resulting public URL in `businesses.logo_url`. The settings form checks only the 5MB client-side size limit; the bucket is the enforcement point. Tested behavior:

- Authenticated owner upload of `image/png` → `200`; public read → `200 image/png`.
- `text/plain`, `text/html`, and `image/svg+xml` → `400 mime type ... is not supported`.
- An upload path without the caller's user-ID prefix → `400` RLS denial.
- Anonymous upload → `400` RLS denial; anonymous list → `200` empty.
- Direct bucket metadata (`GET /storage/v1/bucket/logos`) → `400 Bucket not found` for both anon and authenticated callers, despite successful uploads.

### Upgrade and payment flow

The `/dashboard/upgrade` page uses Paystack Inline. The browser sends `amount`, `currency`, `reference`, and `metadata` (`business_id`, `plan`, `billing`, name) to Paystack; after the popup, the client polls `subscriptions` for a matching `plan` and `paystack_reference`. No server-side verification call appears in the HAR. Plan activation depends on the webhook. See KAL-BL-001 for the unverified amount/metadata validation risk.

---

## 8. Remediation Plan

### Priority 1 — Remove anonymous business contact exposure
- Revoke `email`/`address` from anon on `public.businesses`.
- Keep only the discover columns granted to anon.
- Add regression tests for anon and non-owner access.

### Priority 2 — Restrict internal authenticated columns
- Remove `user_id` and `trust_signals` from the public table's authenticated column set.
- Expose owner-only fields through a view/RPC scoped by `auth.uid() = user_id`.

### Priority 3 — Deny anonymous reads on logging/lead tables
- Remove anon SELECT from `profiles`, `leads`, and `email_logs`.
- Scope `profiles` to own-row; scope leads and email logs to service role/admins.

### Priority 4 — Prove and enforce RLS on business-scoped tables
- Implement/verify owner or membership policies for `customers`, `bookings`, `invoices`, `messages`, `inventory_items`, `expenses`, and `business_payment_details`.
- Make `business_payment_details` service-role-only.
- Scope `listings` by owning business (KAL-DB-005) or make the public subset explicit.
- Add a two-tenant regression test covering all of the above.

### Priority 5 — Decide listing and review visibility
- If public: grant anon only safe display columns, restrict to active rows, and document the intent.
- If private: scope to business ownership and remove cross-tenant reads.
- Change `get_business_pulse` denials from HTTP 200 to `403`.

### Priority 6 — Harden HTTP responses
- Add CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, and `Permissions-Policy`.
- Add `includeSubDomains`/`preload` to HSTS after confirming subdomain readiness.

### Priority 7 — Reduce schema leak surface
- Move internal tables out of the PostgREST-exposed schema or restrict anon schema usage to stop `PGRST205` hints.

### Priority 8 — Keep public config safe
- Continue to ship only the anon key; add a CI secret scan for service-role/private keys.
- Rotate the anon key after broad grants are corrected.

---

## 9. Limitations and Untested Areas

- **Empty tables** (`customers`, `bookings`, `invoices`, `messages`, `notifications`, `inventory_items`, `expenses`, `business_payment_details`, `email_logs`, `leads`) prevent proving row-level scope. KAL-DB-003 must be revisited when rows exist.
- **Admin surface assessment:** A dedicated assessment was conducted on 2026-11-03. `/admin` is an authentication-gated redirect to `/dashboard`; `/dashboard/admin` and `/api/admin` are `404`. Tested admin-like table names returned `404`, and no admin claims were present in the test account's JWT. PostgREST OpenAPI is not exposed (`401` anon/auth), so schema and RPC enumeration was not exhaustive. See `ADMIN-SURFACE-ASSESSMENT-2026-11-03.md` for details.
- **One confirmed account**; email confirmation blocks a second account without mailbox access. Cross-tenant behavior was tested against existing businesses and their owner IDs.
- **Storage:** the `logos` bucket is usable by authenticated owners; anonymous uploads and non-image MIME types were denied. Cross-tenant overwrite/delete, cross-tenant object reads beyond the empty list response, and the bucket's declared metadata (`GET /storage/v1/bucket/logos` returned `400 Bucket not found`) were not fully testable. The uploaded logo is the authorized test business's own image.
- **Public business page:** `/business/kaltrix-labs-assessment` returned `200` and contained the business name, but the logo is hydrated client-side; the initial HTML did not contain the logo URL. No browser automation was used, so the rendered logo and other client-side states were not visually verified.
- **Payment webhook:** the Paystack webhook's signature, amount, currency, metadata, and idempotency checks were not tested; no live payment was made. KAL-BL-001 remains potential.
- **TLS deep scan, DNS/subdomain enumeration, source maps, cookie attributes, password-reset token handling, and auth rate limiting** remain untested.
- **Dashboard and upgrade-flow review** are based on two captured HARs. The exports stripped the `Authorization` header, so the HARs do not themselves prove anonymous access; identity was confirmed by matching the response to the authorized test account. Live browser automation was not used.

---

## 10. Evidence and Reproducibility

| Artifact | Location |
|---|---|
| Access-control transcript (counts/statuses only) | `evidence/access-control-probe.txt` |
| App-logic and RPC probe transcript | `evidence/app-logic-probe.txt` |
| Tier and storage probe transcript | `evidence/tier-storage-probe.txt` |
| Business setup/public-page check | `evidence/business-setup-check.txt` |
| Anonymous/auth storage access transcript | `evidence/storage-access-probe.txt` |
| HAR request inventory (sanitized) | `evidence/har-request-inventory.txt` |
| Admin surface probe output | `evidence/admin-surface-probe.txt` |
| Admin database probe output | `evidence/admin-db-probe.txt` |
| Role escalation probe output | `evidence/role-escalation-probe.txt` |
| Middleware bypass probe output | `evidence/middleware-bypass-probe.txt` |
| Comprehensive database probe output | `evidence/comprehensive-db-probe.txt` |
| JWT decode output | `evidence/jwt-decode.txt` |
| Admin surface assessment report | `ADMIN-SURFACE-ASSESSMENT-2026-11-03.md` |
| Raw dashboard HAR | `../personal/har/kaltrixos.com.har` (retained internally; not included in this package) |
| Raw upgrade/Paystack HAR | `../personal/har/kaltrixos.com.second.har` (retained internally; not included in this package) |
| Per-table JSON exports (redacted) | `database-exports/*.json` |
| Table index | `database-exports/_index.json` |
| Reproducible probes | `scripts/access-control-probe.js`, `scripts/probe-app-logic.js`, `scripts/tier-storage-probe.js`, `scripts/business-setup-check.js`, `scripts/storage-access-probe.js`, `scripts/export-tables.js` |
| Admin probes | `scripts/admin-surface-probe.js`, `scripts/admin-db-probe.js`, `scripts/role-escalation-probe.js`, `scripts/middleware-bypass-probe.js`, `scripts/comprehensive-db-probe.js`, `scripts/jwt-decode.js` |
| Login helper | `scripts/login.js` |
| Live key recovery | `scripts/fetch-live-key.js` |
| Credentials | `credentials/*.example.json` templates; live files are local-only and gitignored |
| Original working tree | `../personal/` (internal archive; not included in this package) |

### Reproduce
```powershell
node scripts/fetch-live-key.js   # if the site rotated the anon key
node scripts/login.js            # writes scripts/session.json
node scripts/access-control-probe.js
node scripts/probe-app-logic.js
node scripts/tier-storage-probe.js      # writes a logo/profile fields on the test business
node scripts/business-setup-check.js    # sets the test-business slug if missing; checks public page
node scripts/storage-access-probe.js    # anon/auth storage checks; anon upload is blocked
node scripts/export-tables.js

# Admin surface assessment (additional scripts)
node scripts/admin-surface-probe.js
node scripts/admin-db-probe.js
node scripts/role-escalation-probe.js
node scripts/middleware-bypass-probe.js
node scripts/comprehensive-db-probe.js
node scripts/jwt-decode.js
```

### Data handling
- No business emails, addresses, or review content are reproduced in this report. The `businesses` export retains `phone` because the application displays it publicly.
- Exports contain public/discover columns, counts, and access statuses. Sensitive columns are omitted or masked as documented in each file.
- `listings.json` omits `name`, `description`, and `image_url`; it retains only catalog metadata.
- `scripts/session.json` contains a bearer token and must not be committed (gitignored).
- The authorized test business was completed during the assessment with synthetic contact values, a public logo, and slug `kaltrix-labs-assessment`. These are not customer data. The `businesses` export still omits `email`, `address`, `user_id`, and `trust_signals`.
- The raw HAR is kept out of `reports/` because it contains request/response data from the authenticated session.

---

## Appendix A — Table Export Notes

| Table | Rows exported | Redactions |
|---|---|---|
| `businesses` | 10 | `email`, `address`, `user_id`, `trust_signals` omitted |
| `profiles` | 1 (own) | name and email masked |
| `subscriptions` | 1 (own) | `paystack_reference` omitted |
| `reviews` | 1 | `comment`, `reviewer_name` omitted; `reviewer_email` denied |
| `listings` | 3 | `name`, `description`, `image_url` omitted |
| `leads`, `customers`, `bookings`, `invoices`, `messages`, `notifications`, `inventory_items`, `expenses`, `business_payment_details`, `email_logs`, `feedback` | 0 | empty at export time; PII/financial columns omitted |
| `rate_limits` | 0 | `403` (denied) |

## Appendix B — Test Environment

- Supabase project: `fgkdkyhnokijbxyxcgug`
- Hosting: Vercel / Next.js App Router (Turbopack)
- Auth: email/password, signup open, email confirmation required
- Test business: owned by the authorized test account; slug `kaltrix-labs-assessment`; `is_verified=false`, `trust_score=20`; logo stored in the public `logos` bucket; synthetic contact values added for setup testing
- Storage: `logos` bucket; authenticated owner uploads and public reads work; anon upload and non-image MIME types denied; cross-tenant storage writes not tested
