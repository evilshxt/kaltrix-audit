# KaltrixOS Security Assessment

Authorized external security assessment of [https://kaltrixos.com/](https://kaltrixos.com/), completed on 2026-11-03.

This repository is the assessment delivery package. It contains the client-facing report, redacted Supabase table exports, captured probe evidence, and reproducible test scripts. The raw working archive (downloaded bundles, raw HARs, session logs, and scratch notes) is intentionally excluded.

## Deliverable

| Artifact | Location |
|---|---|
| Main assessment report | [`reports/KaltrixOS-Security-Assessment-2026-11-03.md`](reports/KaltrixOS-Security-Assessment-2026-11-03.md) |
| Admin surface assessment | [`reports/ADMIN-SURFACE-ASSESSMENT-2026-11-03.md`](reports/ADMIN-SURFACE-ASSESSMENT-2026-11-03.md) |
| Report package guide | [`reports/README.md`](reports/README.md) |
| Redacted database exports | [`reports/database-exports/_index.json`](reports/database-exports/_index.json) |
| Captured probe evidence | [`reports/evidence/`](reports/evidence/) |
| Reproduction scripts | [`reports/scripts/`](reports/scripts/) |

## Findings at a glance

| Status | Count | IDs |
|---|---:|---|
| Confirmed vulnerabilities | 4 | KAL-AC-001, KAL-DB-005, KAL-CF-001, KAL-DC-002 |
| Informational | 1 | KAL-DC-001 |
| Potential / observation | 5 | KAL-DB-001, KAL-DB-002, KAL-DB-003, KAL-DB-004, KAL-BL-001 |

**KAL-AC-001 (Medium)** is the highest-impact confirmed issue: anonymous users can read business `email` and `address` through PostgREST column-level grants, and authenticated users can read `user_id` and `trust_signals` for all businesses.

The separate admin surface assessment is **negative for the tested external vectors**: `/admin` is an authentication-gated redirect to `/dashboard`, `/dashboard/admin` is `404`, role self-escalation was denied, and known middleware-bypass payloads failed. PostgREST OpenAPI is not exposed, so this is not proof that no internal admin capability exists.

The report contains the CVSS 4.0 vectors, evidence, impact, remediation guidance, and negative results. Findings are point-in-time and were validated only against the authorized test account and scope in [`info.txt`](info.txt).

## Repository layout

```text
.
+-- README.md
+-- LICENSE
+-- DISCLAIMER.md
+-- .gitignore
+-- AGENTS.md              # Maintainer notes and assessment runbook
+-- info.txt               # Engagement brief and rules (authoritative)
+-- reports/
    +-- KaltrixOS-Security-Assessment-2026-11-03.md
    +-- ADMIN-SURFACE-ASSESSMENT-2026-11-03.md
    +-- README.md
    +-- credentials/       # Example templates only; live files are local-only
    +-- database-exports/  # One redacted JSON file per Supabase table
    +-- evidence/          # Captured probe output
    +-- scripts/           # Read-only and authorized write probes
```

`personal/` is intentionally excluded by `.gitignore`. It is the internal archive of raw HARs, downloaded client bundles, historical session artifacts, and scratch notes.

## Reproducing the tests

The scripts use only the Node.js standard library. There is no install step.

```powershell
cd reports

# Create local credential files from the committed templates.
Copy-Item credentials/credentials.example.json credentials/credentials.json
Copy-Item credentials/secrets.example.json credentials/secrets.json

# Fill in the authorized test account and current project values.
# Then refresh the live anon key from the target's public bundles.
node scripts/fetch-live-key.js --update

# Log in and run the read-only checks.
node scripts/login.js
node scripts/access-control-probe.js
node scripts/probe-app-logic.js

# Authorized write probes on the test business only.
node scripts/tier-storage-probe.js
node scripts/business-setup-check.js
node scripts/storage-access-probe.js

# Regenerate the redacted table exports.
node scripts/export-tables.js

# Optional: reproduce the admin surface checks.
node scripts/admin-surface-probe.js
node scripts/admin-db-probe.js
node scripts/role-escalation-probe.js
node scripts/middleware-bypass-probe.js
node scripts/comprehensive-db-probe.js
node scripts/jwt-decode.js
```

The write probes are intended only for the authorized test account and test business described in the report. Do not run them against another account or tenant.

## Credentials and data handling

- The live test-account password and live Supabase anon-key file are **not committed**. They are ignored by git; only the example templates are tracked.
- No Supabase `service_role` key, private key, customer PII, or sensitive production record is included.
- Database exports contain counts, access status, public data, or masked values only. JWT metadata in the admin evidence is redacted.
- `reports/scripts/session.json` is a local bearer-token cache and is gitignored.
- Deliver live credentials through a secure client channel and rotate the test-account password after sharing.

## Disclaimer

This work was performed under explicit authorization and is limited to the scope and rules in [`info.txt`](info.txt). The material is provided for the client's review and remediation planning, without warranty, and reflects the target only during the assessment window. Do not use the scripts or techniques against any system without written authorization. See [`DISCLAIMER.md`](DISCLAIMER.md) for the full disclaimer.

## License

Released under the MIT License. See [`LICENSE`](LICENSE).
