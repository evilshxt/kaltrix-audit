# Disclaimer

This repository documents an authorized security assessment of [https://kaltrixos.com/](https://kaltrixos.com/) performed on 2026-11-03. Testing was limited to the scope, rules, and constraints in [`info.txt`](info.txt).

## Authorized use

The material is provided for the client's review and remediation planning. It is not an invitation to test the target, its users, or its infrastructure. Do not use the scripts, techniques, or findings against any system without explicit written authorization.

## No warranty

The assessment is point-in-time. Findings reflect the state of the target during the assessment window and may not reflect its current condition. The report is provided "as is", without warranty of any kind, and is not a guarantee that no vulnerabilities remain. It is not legal, compliance, or professional advice.

## Data handling

The repository is intentionally redacted:

- No customer PII, sensitive production records, service-role keys, private keys, or persistent access are included.
- The test business and its contact values are synthetic test data.
- Live test-account credentials and the live anon-key file are local-only and gitignored; only placeholder templates are committed.
- Raw HARs and historical session artifacts are retained outside the repository in the gitignored `personal/` archive.

If you believe sensitive data was included by mistake, contact the repository owner so it can be removed.

## Reporting

The report separates confirmed findings, potential findings, observations, and controls that held. Empty tables, untested surfaces, and unverified product intent are called out as limitations rather than confirmed vulnerabilities.
