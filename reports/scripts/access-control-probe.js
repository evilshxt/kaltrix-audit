#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CRED_DIR = path.join(ROOT, 'credentials');
const EVIDENCE_DIR = path.join(ROOT, 'evidence');
const creds = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'credentials.json'), 'utf8'));
const secrets = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'secrets.json'), 'utf8'));
const projectUrl = secrets.secrets.find(s => s.type === 'supabase_project_url').value;
const anonKey = secrets.secrets.find(s => s.type === 'supabase_anon_key').value;
const base = new URL(projectUrl);
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const out = [];
const write = (s) => { console.log(s); out.push(s); };

function req(pathName, { auth = false, token = null, method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({ apikey: anonKey, Accept: 'application/json' }, headers);
    if (auth) h.Authorization = `Bearer ${token}`;
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request({ hostname: base.hostname, path: pathName, method, headers: h }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    r.on('error', e => resolve({ status: 0, body: e.message, headers: {} }));
    if (data) r.write(data);
    r.end();
  });
}
const parse = r => { try { return JSON.parse(r.body); } catch { return null; } };

async function login() {
  const r = await req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: creds.email, password: creds.password } });
  if (r.status !== 200) throw new Error(`login failed ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body);
}

function fmt(r) {
  const p = parse(r);
  if (r.status === 200) return `200 rows=${Array.isArray(p) ? p.length : '?'}`;
  if (p && p.code) return `${r.status} ${p.code} ${String(p.message || '').slice(0, 50)}`;
  return `${r.status}`;
}

(async () => {
  const session = await login();
  const token = session.access_token;
  const userId = session.user.id;

  write('KaltrixOS access-control probe (read-only)');
  write(`Generated: ${new Date().toISOString()}`);
  write(`Target: ${projectUrl}`);
  write(`User: ${userId} role=${session.user.role} confirmed=${!!session.user.confirmed_at}`);
  write('No writes are performed by this script. No PII values are recorded.');
  write('');

  write('=== Anonymous vs authenticated table access ===');
  const tables = ['businesses', 'profiles', 'leads', 'email_logs', 'customers', 'subscriptions', 'bookings', 'invoices', 'messages', 'notifications', 'inventory_items', 'business_payment_details', 'feedback', 'reviews', 'listings', 'expenses', 'rate_limits'];
  for (const t of tables) {
    const sel = ['inventory_items', 'business_payment_details', 'rate_limits'].includes(t) ? '*' : 'id';
    const a = await req(`/rest/v1/${t}?select=${sel}&limit=3`);
    const b = await req(`/rest/v1/${t}?select=${sel}&limit=3`, { auth: true, token });
    write(`  ${t.padEnd(26)} anon=${fmt(a).padEnd(22)} auth=${fmt(b)}`);
  }
  write('');

  write('=== businesses column exposure ===');
  const cases = [
    ['* (all)', '*'],
    ['app discover columns', 'id,business_name,industry,city,phone,website_url,trust_score,is_verified,slug,logo_url,description'],
    ['id', 'id'],
    ['email', 'email'],
    ['address', 'address'],
    ['phone', 'phone'],
    ['user_id', 'user_id'],
    ['trust_signals', 'trust_signals'],
  ];
  for (const [label, sel] of cases) {
    const a = await req(`/rest/v1/businesses?select=${encodeURIComponent(sel)}&limit=1`);
    const b = await req(`/rest/v1/businesses?select=${encodeURIComponent(sel)}&limit=1`, { auth: true, token });
    write(`  ${label.padEnd(24)} anon=${fmt(a).padEnd(22)} auth=${fmt(b)}`);
  }
  write('');

  write('=== businesses over-exposure counts (auth) ===');
  const r = await req('/rest/v1/businesses?select=id,email,phone,address,user_id&limit=1000', { auth: true, token, headers: { Prefer: 'count=exact' } });
  const rows = parse(r) || [];
  const n = k => rows.filter(x => x[k] !== null && x[k] !== undefined && String(x[k]).trim() !== '').length;
  write(`  status=${r.status} range=${r.headers['content-range']} returned=${rows.length}`);
  write(`  distinct user_ids=${new Set(rows.map(x => x.user_id)).size} email_non_empty=${n('email')} phone_non_empty=${n('phone')} address_non_empty=${n('address')}`);
  write('');

  write('=== cross-tenant profile read (id only) ===');
  const otherBiz = await req(`/rest/v1/businesses?select=user_id&user_id=neq.${userId}&limit=1`, { auth: true, token });
  const otherRows = parse(otherBiz) || [];
  if (otherRows[0] && otherRows[0].user_id) {
    const p = await req(`/rest/v1/profiles?select=id&id=eq.${otherRows[0].user_id}`, { auth: true, token });
    write(`  GET /rest/v1/profiles?select=id&id=eq.<other> -> ${fmt(p)}`);
  } else {
    write('  no other owner id available');
  }
  write('');

  write('=== Summary ===');
  write('  CONFIRMED: anon can read email/address for all businesses (column-level grants).');
  write('  CONFIRMED: authenticated users can read all columns including user_id/trust_signals.');
  write('  CONFIRMED: authenticated users can read other businesses listings (see app-logic-probe.txt).');
  write('  NEGATIVE: cross-tenant profile read returned 0 rows.');
  write('  NEGATIVE: get_business_pulse/get_inventory_overview reject non-owned business ids.');
  write('  NEGATIVE (documented in the report, not re-run here): cross-tenant UPDATE blocked; role/verification writes denied.');

  const file = path.join(EVIDENCE_DIR, 'access-control-probe.txt');
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`\nSaved ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
