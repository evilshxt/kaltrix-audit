# AGENTS.md — KaltrixOS Security Assessment

## What this repository is

This is the working and delivery repository for an **authorized external security assessment** of **https://kaltrixos.com/**. The engagement brief, scope, rules, and reporting standards are in `info.txt` at the repository root. Read it before doing anything.

This is not an application source repository. It contains assessment artifacts: reconnaissance notes, findings, evidence, scripts, a client-facing report, and redacted database exports.

## Repository layout

```
/
├── README.md     # Repository overview, findings summary, reproduction steps
├── LICENSE       # MIT
├── DISCLAIMER.md # Authorized-use and no-warranty disclaimer
├── info.txt      # Engagement brief and rules (authoritative)
├── AGENTS.md     # This file
├── .gitignore    # Ignores personal/, live credentials, session tokens, tooling noise
├── personal/     # Full archived original working tree (gitignored)
└── reports/      # Client deliverable
    ├── KaltrixOS-Security-Assessment-2026-11-03.md
    ├── ADMIN-SURFACE-ASSESSMENT-2026-11-03.md
    ├── README.md
    ├── credentials/         # Example templates; live credentials are gitignored
    ├── scripts/             # Reproducible testing/export scripts
    ├── database-exports/    # One JSON file per Supabase table (redacted)
    └── evidence/            # Captured probe output
```

### `personal/`
This is the entire original working tree moved intact: `database/`, `evidence/`, `findings/`, `js/`, `json/`, `logs/`, `reconnaissance/`, `reports/`, `static/`, `tests/`, plus the old root files (`status.md`, `FINAL_STATUS_REPORT.md`, `credentials.json`, `secrets.json`, `business_logo.md`, `image.png`). It is the historical record. Do not delete it to "clean up"; it is already gitignored. If you need raw evidence or downloaded client bundles, look here.

### `reports/`
The deliverable. Keep it client-ready:
- No fabricated results.
- No PII, tokens, or private keys.
- Distinguish **Confirmed**, **Potential**, **Observation**, and **Negative** results.
- Keep the report, exports, evidence, and scripts consistent with each other.

## Engagement rules (summary of `info.txt`)

- Authorized target: `https://kaltrixos.com/` and explicitly included infrastructure only.
- Non-destructive testing: never delete/modify production records, establish persistence, deploy malware, or perform DoS/resource exhaustion.
- Preserve minimal evidence; do not bulk-extract customer records, credentials, or personal data.
- If a minimal proof-of-concept establishes a finding, stop escalating.
- Do not report speculative issues as confirmed. Use CVSS 4.0 and the reporting structure in `info.txt`.
- If an operation could affect availability, modify production data, or expose sensitive information, stop and document the limitation.

## Current assessment status (as of 2026-11-03)

**Confirmed**
- **KAL-AC-001 (Medium):** anonymous users can read business `email` and `address` via PostgREST column-level grants; authenticated users can read `user_id` and `trust_signals` for all businesses.
- **KAL-DC-002 (Low):** `PGRST205` hints leak internal table names.
- **KAL-CF-001 (Low):** missing CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **KAL-DC-001 (Info):** Supabase URL + anon key in client bundles (public-by-design).
- **KAL-DB-005 (Low, confirmed access):** authenticated users can read other businesses' `listings` (name, description, price, image URL, active flag). No PII; product intent unclear.

**Potential / observation**
- **KAL-DB-001:** anon SELECT on `profiles` and `leads` (empty).
- **KAL-DB-002:** anon SELECT on `email_logs` (empty).
- **KAL-DB-003:** authenticated SELECT on `customers`, `bookings`, `invoices`, `messages`, `inventory_items`, `expenses`, `business_payment_details` (empty; scope unverified).
- **KAL-DB-004:** authenticated cross-tenant review reads; product intent unclear.
- **KAL-BL-001:** Paystack upgrade flow sends client-controlled `amount` and `metadata.plan`; the webhook's amount/currency/metadata validation is unverified (no live payment).

**Controls that held (negative results)**
- Cross-tenant business UPDATE blocked (0 rows represented).
- Owner cannot self-set `is_verified` / `trust_score`.
- `/admin` redirects unauthenticated callers to `/login` and authenticated callers to `/dashboard`; `/dashboard/admin` and `/api/admin` are `404`.
- Tested CVE-2025-29927 and header-spoofing variants did not bypass the auth redirect.
- Tested admin-like tables (`admin_users`, `admin_logs`, etc.) return `404`; OpenAPI `/rest/v1/` returns `401` anon/auth.
- `profiles.role` self-update denied.
- Cross-tenant profile reads return 0 rows.
- `profiles`/`subscriptions` are own-row only. A direct owner `PATCH` to `subscriptions.plan` (`pro` → `growth`) returned `200` with the row but left the plan unchanged; plan activation stayed server-side.
- `logos` storage: authenticated owner upload and public read work; `text/plain`, `text/html`, and `image/svg+xml` rejected; an upload path without the caller's user-ID prefix rejected by RLS; anonymous upload rejected by RLS; anon/auth list returned empty.
- Anon denied on the sensitive business tables.
- `get_inventory_overview` rejects non-owned `p_business_id` with `403 not_authorized`.
- `get_business_pulse` rejects non-owned `p_business_id` with `{error:"not_authorized"}` (HTTP 200; no data) and anon with 401.
- Cross-tenant `business_payment_details`, `expenses`, `bookings`, `customers`, `invoices`, `messages`, `notifications` returned 0 rows (empty tables).
- `GET /storage/v1/bucket/logos` returned `400 Bucket not found` to anon and authenticated callers despite successful uploads; bucket metadata was not readable.

**Limitations:** empty tables hide RLS scope; one confirmed account; no mailbox; admin surface assessed (`/admin` is an auth redirect to `/dashboard`, `/dashboard/admin` is `404`, tested admin-like tables are `404`, and PostgREST OpenAPI is not exposed); cross-tenant storage overwrite/delete untested; public-page logo rendering not visually verified; Paystack webhook validation untested (no live payment); TLS/DNS/source maps, cookies, password-reset, and auth rate limiting untested. Dashboard and upgrade review are HAR-based; the exports stripped the Authorization header.

## Key operational facts

- Supabase project ref: `fgkdkyhnokijbxyxcgug`
- Test account: local `reports/credentials/credentials.json` (Supabase user `f3411683-3e65-4922-a2a0-3199f98c9e95`); the filled file is gitignored. Use `credentials.example.json` as the template.
- Test business: slug `kaltrix-labs-assessment`, `trust_score=20`, logo set in the public `logos` bucket; synthetic email/address added for setup testing
- Live anon key: local `reports/credentials/secrets.json` (SEC-002; rotated during engagement); the filled file is gitignored. Use `secrets.example.json` as the template.
- The anon key is public-by-design, but the test-account password is sensitive. Only the example templates are committed. Never add a Supabase `service_role` key to this repo.
- Anon key rotations: if `/auth/v1/settings` returns `401 Invalid API key`, run `node reports/scripts/fetch-live-key.js --update`.

## How to run the deliverable scripts

```powershell
cd reports
Copy-Item credentials/credentials.example.json credentials/credentials.json
Copy-Item credentials/secrets.example.json credentials/secrets.json
# Fill the local files before running the probes.
node scripts/fetch-live-key.js          # inspect current key
node scripts/fetch-live-key.js --update # update credentials/secrets.json
node scripts/login.js                   # writes scripts/session.json (gitignored)
node scripts/access-control-probe.js    # read-only anon/auth matrix + column exposure
node scripts/probe-app-logic.js         # cross-tenant table + RPC probes from the HAR
node scripts/tier-storage-probe.js      # plan write/restore + logos upload/MIME/prefix checks (writes)
node scripts/business-setup-check.js    # set test-business slug if missing; check public page
node scripts/storage-access-probe.js    # anon/auth storage metadata, list, upload checks
node scripts/export-tables.js           # regenerate database-exports/*.json (17 tables)
node scripts/admin-surface-probe.js     # SSR-cookie admin route checks
node scripts/admin-db-probe.js          # admin-like table/OpenAPI checks (does not invoke guessed RPCs)
node scripts/role-escalation-probe.js   # test-account-only role update checks
node scripts/middleware-bypass-probe.js # CVE-2025-29927/header-spoofing variants
node scripts/comprehensive-db-probe.js  # GraphQL/admin-column/OpenAPI checks
node scripts/jwt-decode.js              # redacted JWT claims
```

## Rules for future agents

1. **Read `info.txt` first.** It overrides convenience.
2. **Do not fabricate or inflate.** If a test was not run, say so. If a table was empty, say the impact is unproven.
3. **Keep PII out of the repo.** Reports and exports must use counts, statuses, redacted values, or synthetic data. `businesses.json` intentionally omits `email`, `address`, `user_id`, and `trust_signals`; `profiles.json` masks name and email; `subscriptions.json` omits `paystack_reference`; `reviews.json` omits `comment` and `reviewer_name`; `listings.json` omits `name`, `description`, and `image_url`.
4. **Do not write to production data** except for reversible same-value/no-op probes on the authorized test account, and only when necessary to prove a control. Document what was done.
5. **Keep `personal/` intact.** It is the audit archive. Add new raw evidence there if needed; put polished deliverables in `reports/`.
6. **Keep the report and exports in sync** if you discover or revalidate findings.
7. **Do not commit** unless the user explicitly asks. `personal/`, `reports/credentials/credentials.json`, `reports/credentials/secrets.json`, and `reports/scripts/session.json` are gitignored and must never be committed; only the `*.example.json` templates are tracked.

## Suggested next steps

1. Re-test KAL-DB-003 once business-scoped tables contain rows; use two synthetic tenants if a second confirmed account is available.
2. Verify remediation of KAL-AC-001: anon must not read `email`/`address`; non-owners must not read `user_id`/`trust_signals`.
3. Decide listing visibility and verify KAL-DB-005: either allow anon reads on safe active rows or scope reads to the owning business.
4. Verify the Paystack webhook server-side: signature, amount, currency, metadata plan, reference, and idempotency (KAL-BL-001). Do not test with a live payment unless the client authorizes it.
5. Review the authenticated dashboard's client-side network calls beyond the HAR: invoice-by-ID, upgrade/payment flow, and any client-side admin route or permission checks.
6. If a second confirmed account becomes available, test cross-tenant storage upload/overwrite/delete and re-test the empty business-scoped tables with rows.
7. Complete TLS, DNS/subdomain, source-map, cookie, password-reset, and light auth rate-limit testing.
8. **Admin surface:** Negative for tested external vectors. `/admin` redirects unauthenticated callers to `/login` and authenticated callers to `/dashboard`; `/dashboard/admin` and `/api/admin` return `404`; tested admin-like tables return `404`; OpenAPI is `401` for anon/auth. This is not exhaustive proof that no admin capability exists. See `reports/ADMIN-SURFACE-ASSESSMENT-2026-11-03.md`.
