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

let authToken = null;
const sessionPath = path.join(__dirname, 'session.json');
if (fs.existsSync(sessionPath)) {
  authToken = JSON.parse(fs.readFileSync(sessionPath, 'utf8')).access_token;
}

function request(pathname, { method = 'GET', auth = false, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${auth && authToken ? authToken : anonKey}`,
      Accept: 'application/json',
    };
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
      res.on('end', () => resolve({
        status: res.statusCode,
        body: responseBody,
        contentType: res.headers['content-type'] || '',
      }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function errorSummary(body) {
  try {
    const j = JSON.parse(body);
    return [j.code, j.message].filter(Boolean).join(': ').slice(0, 160);
  } catch {
    return body.slice(0, 160);
  }
}

async function main() {
  console.log('=== Admin Database Probe ===\n');

  const tables = [
    'admin_users', 'admin_logs', 'admin_settings', 'permissions',
    'roles', 'audit_logs', 'system_config',
  ];

  for (const [label, auth] of [['anon', false], ['authenticated', true]]) {
    if (auth && !authToken) {
      console.log('No session.json; skipping authenticated table checks.\n');
      continue;
    }
    console.log(`--- Admin-like tables (${label}) ---\n`);
    for (const table of tables) {
      const r = await request(`/rest/v1/${table}?select=id&limit=1`, { auth });
      console.log(`${table}: ${r.status}${r.status >= 400 ? ` (${errorSummary(r.body)})` : ''}`);
    }
    console.log('');
  }

  console.log('--- PostgREST OpenAPI /rest/v1/ ---\n');
  for (const [label, auth] of [['anon', false], ['authenticated', true]]) {
    if (auth && !authToken) continue;
    const r = await request('/rest/v1/', { auth });
    console.log(`${label}: ${r.status} ${r.contentType} (${r.body.length} bytes)`);
    if (r.status === 200) {
      try {
        const schema = JSON.parse(r.body);
        const paths = Object.keys(schema.paths || {});
        const definitions = Object.keys(schema.definitions || {});
        console.log(`  paths: ${paths.length}; definitions: ${definitions.length}`);
        const adminLike = paths.concat(definitions)
          .filter(name => /admin|verify|approve|suspend|role|trust|payout/i.test(name));
        if (adminLike.length) console.log(`  admin-like names: ${adminLike.slice(0, 30).join(', ')}`);
      } catch {
        console.log('  OpenAPI response was not JSON.');
      }
    }
    if (r.status >= 400) console.log(`  ${errorSummary(r.body)}`);
  }

  if (authToken) {
    console.log('\n--- Test-account profile role ---\n');
    const r = await request('/rest/v1/profiles?select=role', { auth: true });
    console.log(`Status: ${r.status}`);
    console.log(`Body: ${r.body.slice(0, 160)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
