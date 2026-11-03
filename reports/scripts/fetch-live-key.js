#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED_DIR = path.resolve(__dirname, '..', 'credentials');
const SECRETS = path.join(CRED_DIR, 'secrets.json');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'KaltrixOS-security-audit' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(new URL(res.headers.location, url).href).then(resolve, reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  const base = 'https://kaltrixos.com';
  const login = await get(base + '/login');
  console.log(`GET /login -> ${login.status} (${login.body.length} bytes)`);

  const refs = new Set();
  const re = /(?:src|href)="([^"]+\.js)"/g;
  let m;
  while ((m = re.exec(login.body))) {
    let u = m[1];
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = base + u;
    refs.add(u);
  }

  const candidates = new Set(refs);
  for (const u of refs) {
    const r = await get(u);
    const dyn = /static\/immutable\/chunks\/([a-zA-Z0-9_-]+\.js)/g;
    let d;
    while ((d = dyn.exec(r.body))) candidates.add(`${base}/_next/static/immutable/chunks/${d[1]}`);
  }

  let found = null;
  for (const u of candidates) {
    const r = await get(u);
    if (r.status !== 200) continue;
    const proj = r.body.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
    const jwt = r.body.match(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/);
    if (proj && jwt) { found = { project: proj[0], key: jwt[0], source: u }; break; }
  }

  if (!found) {
    console.error('No Supabase config found in live bundles.');
    process.exit(1);
  }

  let claims = {};
  try { claims = JSON.parse(Buffer.from(found.key.split('.')[1], 'base64url').toString()); } catch {}
  console.log(`source: ${found.source}`);
  console.log(`project: ${found.project}`);
  console.log(`anon key: ${found.key}`);
  console.log(`claims: role=${claims.role} ref=${claims.ref} exp=${claims.exp}`);

  const secrets = JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
  const entry = secrets.secrets.find(s => s.type === 'supabase_anon_key');
  console.log(`matches reports/credentials/secrets.json: ${entry.value === found.key}`);

  if (process.argv.includes('--update')) {
    entry.value = found.key;
    entry.source = `live bundle ${found.source} @ ${new Date().toISOString()}`;
    entry.last_verified_at = new Date().toISOString();
    secrets.last_verified_at = new Date().toISOString();
    fs.writeFileSync(SECRETS, JSON.stringify(secrets, null, 2) + '\n', 'utf8');
    console.log('updated reports/credentials/secrets.json');
  } else {
    console.log('pass --update to write the live key into reports/credentials/secrets.json');
  }
})().catch(e => { console.error(e); process.exit(1); });
