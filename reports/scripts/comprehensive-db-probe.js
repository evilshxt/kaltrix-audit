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

async function main() {
  console.log('=== Comprehensive Database Probe ===\n');

  console.log('--- pg_graphql ---\n');
  const graphql = await request('/graphql/v1', {
    method: 'POST',
    body: { query: '{ __schema { types { name } } }' },
  });
  console.log(`Status: ${graphql.status}`);
  console.log(`Body preview: ${graphql.body.slice(0, 200)}`);

  console.log('\n--- Known tables: admin-like columns ---\n');
  const tables = [
    'businesses', 'profiles', 'subscriptions', 'listings', 'reviews',
    'customers', 'bookings', 'invoices', 'messages', 'inventory_items',
    'expenses', 'business_payment_details',
  ];
  const columns = [
    'is_admin', 'role', 'admin_notes', 'approved_by', 'approved_at',
    'suspended_at', 'suspended_by',
  ];
  for (const table of tables) {
    for (const column of columns) {
      const r = await request(`/rest/v1/${table}?select=${column}`, { auth: true });
      if (r.status === 200 && r.body !== '[]') {
        console.log(`${table}.${column}: present (200)`);
      }
    }
  }

  console.log('\n--- PostgREST OpenAPI /rest/v1/ ---\n');
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
  }

  if (authToken) {
    console.log('\n--- Profile rows visible to test account ---\n');
    const r = await request('/rest/v1/profiles?select=role', { auth: true });
    console.log(`Status: ${r.status}`);
    if (r.status === 200) {
      try {
        const rows = JSON.parse(r.body);
        console.log(`Rows visible: ${rows.length}`);
        console.log(`Roles: ${rows.map(row => row.role).join(', ')}`);
      } catch {
        console.log('Response was not JSON.');
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
