# Credentials

Only placeholder templates are committed:

- `credentials.example.json`
- `secrets.example.json`

Create the live local files before running the scripts:

```powershell
Copy-Item credentials.example.json credentials.json
Copy-Item secrets.example.json secrets.json
```

Fill in the authorized test account and project values. The live files are gitignored and must never be committed. Deliver them through a secure client channel and rotate the test-account password after sharing.

`scripts/fetch-live-key.js --update` can refresh the anon-key entry in the local `secrets.json` from the target's public bundles. The anon key is public-by-design, but the filled file is still local-only to keep the repository free of live infrastructure values.
