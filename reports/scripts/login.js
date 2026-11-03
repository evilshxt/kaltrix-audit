#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED_DIR = path.resolve(__dirname, '..', 'credentials');
const creds = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'credentials.json'), 'utf8'));
const secrets = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'secrets.json'), 'utf8'));
const projectUrl = secrets.secrets.find(s => s.type === 'supabase_project_url').value;
const anonKey = secrets.secrets.find(s => s.type === 'supabase_anon_key').value;
const url = new URL(projectUrl);

function post(pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: pathName,
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const r = await post('/auth/v1/token?grant_type=password', { email: creds.email, password: creds.password });
  if (r.status !== 200) {
    console.error(`Login failed: ${r.status} ${r.body.slice(0, 300)}`);
    process.exit(1);
  }
  const session = JSON.parse(r.body);
  console.log('Login OK');
  console.log(`user_id: ${session.user.id}`);
  console.log(`role: ${session.user.role}`);
  console.log(`email_confirmed: ${!!session.user.confirmed_at}`);
  console.log(`expires_in: ${session.expires_in}s`);
  const out = path.resolve(__dirname, 'session.json');
  fs.writeFileSync(out, JSON.stringify(session, null, 2) + '\n', 'utf8');
  console.log(`session written to ${out} (gitignored; contains a bearer token)`);
})().catch(e => { console.error(e); process.exit(1); });
