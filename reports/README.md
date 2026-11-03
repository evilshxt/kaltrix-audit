# KaltrixOS Security Assessment — Report Package

This folder is the client-facing report package within the assessment repository. The full original working tree (all raw evidence, downloaded bundles, scratch notes, and historical status files) is preserved internally in `../personal/`, which is gitignored. The raw dashboard HAR and upgrade/Paystack HAR are retained there and are not part of this client package.

## Contents

| Path | Purpose |
|---|---|
| `KaltrixOS-Security-Assessment-2026-11-03.md` | Main external security assessment report |
| `ADMIN-SURFACE-ASSESSMENT-2026-11-03.md` | Admin surface and privilege escalation assessment (negative for tested external vectors) |
| `credentials/credentials.example.json` | Template for the authorized test-account credentials |
| `credentials/secrets.example.json` | Template for the Supabase project URL and anon key |
| `credentials/README.md` | Local credential setup instructions |
| `scripts/fetch-live-key.js` | Recovers the current anon key from the live login bundles (`--update` writes it to `credentials/secrets.json`) |
| `scripts/login.js` | Logs in with the test account and writes a local `session.json` (bearer token; gitignored) |
| `scripts/access-control-probe.js` | Read-only anon-vs-auth table matrix, business column-exposure checks, cross-tenant profile check |
| `scripts/probe-app-logic.js` | Read-only cross-tenant table and RPC probes derived from the dashboard HAR |
| `scripts/tier-storage-probe.js` | Authenticated tier/storage probe: plan write/restore, `logos` upload/public read, MIME and path-prefix checks (writes to the test business) |
| `scripts/business-setup-check.js` | Completes the test-business slug if missing and checks anon/public-page exposure |
| `scripts/storage-access-probe.js` | Anon/auth storage metadata, list, and upload checks |
| `scripts/export-tables.js` | Regenerates `database-exports/` (17 tables) |
| `scripts/admin-surface-probe.js` | Checks admin routes with a constructed `@supabase/ssr` cookie and follows no redirects |
| `scripts/admin-db-probe.js` | Tests admin-like table names and the PostgREST OpenAPI endpoint; does not invoke guessed RPCs |
| `scripts/role-escalation-probe.js` | Tests test-account-only `profiles.role` updates and profile row visibility |
| `scripts/middleware-bypass-probe.js` | Tests CVE-2025-29927 and header-spoofing variants against protected routes |
| `scripts/comprehensive-db-probe.js` | Tests GraphQL, admin-like columns, and the OpenAPI endpoint |
| `scripts/jwt-decode.js` | Decodes JWT claims without verification; PII values are redacted |
| `database-exports/*.json` | One JSON file per Supabase table, with sensitive fields redacted |
| `database-exports/_index.json` | Table index with auth/anon status and row counts |
| `evidence/access-control-probe.txt` | Captured output of the access-control probe |
| `evidence/app-logic-probe.txt` | Captured output of the cross-tenant/RPC probe |
| `evidence/tier-storage-probe.txt` | Captured output of the tier/storage probe |
| `evidence/business-setup-check.txt` | Captured output of the business setup/public-page check |
| `evidence/storage-access-probe.txt` | Captured output of the anon/auth storage access probe |
| `evidence/har-request-inventory.txt` | Sanitized inventory of dashboard requests (no values) |
| `evidence/admin-surface-probe.txt` | Admin route and `_next/data` output for unauthenticated and test-account requests |
| `evidence/admin-db-probe.txt` | Admin-like table and OpenAPI probe output |
| `evidence/role-escalation-probe.txt` | Test-account role update and profile visibility output (PII redacted) |
| `evidence/middleware-bypass-probe.txt` | Middleware bypass variant output |
| `evidence/comprehensive-db-probe.txt` | GraphQL, admin-column, and OpenAPI probe output |
| `evidence/jwt-decode.txt` | JWT claims analysis output (PII redacted) |

## Quick start

```powershell
# 0. Create local credential files from the committed templates
Copy-Item credentials/credentials.example.json credentials/credentials.json
Copy-Item credentials/secrets.example.json credentials/secrets.json
# Fill in the authorized test account and project values before running the probes.

# 1. Recover the current anon key if the site rotated it
node scripts/fetch-live-key.js --update

# 2. Log in (writes scripts/session.json)
node scripts/login.js

# 3. Reproduce the access-control matrix
node scripts/access-control-probe.js

# 4. Reproduce the cross-tenant/RPC checks
node scripts/probe-app-logic.js

# 5. Authenticated write probes on the authorized test account
node scripts/tier-storage-probe.js
node scripts/business-setup-check.js
node scripts/storage-access-probe.js

# 6. Regenerate the per-table JSON exports
node scripts/export-tables.js

# 7. Optional: reproduce the admin surface checks
node scripts/admin-surface-probe.js
node scripts/admin-db-probe.js
node scripts/role-escalation-probe.js
node scripts/middleware-bypass-probe.js
node scripts/comprehensive-db-probe.js
node scripts/jwt-decode.js
```

## Data-handling notes

- The engagement rules prohibit bulk extraction of customer records, credentials, or personal data. The exports therefore record **counts, access status, and non-sensitive/public columns only**.
- `businesses.json` omits `email`, `address`, `user_id`, and `trust_signals`; `profiles.json` masks the name and email; `subscriptions.json` omits `paystack_reference`; `reviews.json` omits `comment` and `reviewer_name`; `listings.json` omits `name`, `description`, and `image_url`.
- The authorized test business was completed with a logo, synthetic contact values, and slug `kaltrix-labs-assessment`; these are test data, not customer data. The `businesses` export still omits `email`, `address`, `user_id`, and `trust_signals`.
- Tables that were empty at export time still have a JSON file with the access status, row count, and redaction notes.
- No access tokens or service-role keys are stored in this package. `scripts/session.json` is local-only and gitignored.
- JWT metadata values in the admin report and evidence are redacted; the test-account email and display name are not included.
- Only the `credentials/*.example.json` templates are committed. The filled `credentials.json` and `secrets.json` are local-only and gitignored.
- Treat the local credential files as sensitive even though the anon key is shipped to every browser. Do not add a Supabase service-role key here.

## Submission notes

- The repository root is the submission; this folder remains the client-facing report package. `../personal/` is the internal audit archive and contains raw HARs and historical session artifacts; it is gitignored and must be excluded from any manual zip.
- The live `credentials/credentials.json` and `credentials/secrets.json` are gitignored. Deliver the authorized test-account password through a secure client channel and rotate it after sharing.
- No `service_role` key is present in the repository.
- `scripts/session.json` is local-only and is not included in the package.
