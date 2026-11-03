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

function shape(r) {
  const p = parse(r);
  if (p && !Array.isArray(p) && p.code) return `${r.status} ${p.code} ${String(p.message || '').slice(0, 40)}`;
  if (Array.isArray(p)) return `${r.status} rows=${p.length}`;
  if (p && typeof p === 'object') return `${r.status} object`;
  return `${r.status}`;
}
function count(r) {
  const p = parse(r);
  if (Array.isArray(p)) return p.length;
  return null;
}
function boolRow(r, fields) {
  const p = parse(r);
  const rows = Array.isArray(p) ? p : (p ? [p] : []);
  const res = {};
  for (const f of fields) res[f] = rows.some(x => x && x[f] !== null && x[f] !== undefined && String(x[f]).trim() !== '');
  return res;
}
function pulseSummary(r) {
  const p = parse(r);
  if (!p || Array.isArray(p)) return shape(r);
  if (p.error) return `${r.status} error=${String(p.error).slice(0, 40)}`;
  if (p.message) return `${r.status} code=${p.code || ''} message=${String(p.message).slice(0, 40)}`;
  const n = (k) => (typeof p[k] === 'number' ? p[k] : null);
  const nz = (k) => { const v = n(k); return v !== null && v !== 0; };
  return `${r.status} has_any_data=${p.has_any_data} bookings=${n('bookings')} customers=${n('customers')} invoices=${n('invoices')} listings=${n('listings')} expenses=${n('expenses')} revenue_nonzero=${nz('revenue')} profit_nonzero=${nz('profit')}`;
}
function invSummary(r) {
  const p = parse(r);
  if (!p || Array.isArray(p)) return shape(r);
  if (p.message) return `${r.status} code=${p.code || ''} message=${String(p.message).slice(0, 40)}`;
  const items = Array.isArray(p.items) ? p.items.length : null;
  return `${r.status} total=${p.total} untracked_total=${p.untracked_total} items=${items}`;
}

const q = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%2C/g, ',')}`).join('&');

(async () => {
  const session = await login();
  const token = session.access_token;
  const userId = session.user.id;

  const ownBizR = await req(`/rest/v1/businesses?${q({ select: 'id,business_name,user_id', user_id: `eq.${userId}` })}`, { auth: true, token });
  const ownBiz = (parse(ownBizR) || [])[0];
  if (!ownBiz) throw new Error('could not resolve own business');
  const ownBizId = ownBiz.id;

  const allBizR = await req(`/rest/v1/businesses?${q({ select: 'id,business_name,user_id', limit: 20 })}`, { auth: true, token });
  const allBiz = (parse(allBizR) || []).filter(b => b && b.id);
  const others = allBiz.filter(b => b.id !== ownBizId).slice(0, 3);
  const other = others[0] || null;

  write('KaltrixOS app-logic probe (read-only)');
  write(`Generated: ${new Date().toISOString()}`);
  write(`Target: ${projectUrl}`);
  write(`User: ${userId} role=${session.user.role} confirmed=${!!session.user.confirmed_at}`);
  write(`Own business resolved: ${ownBizId ? 'yes' : 'no'}; other tenants sampled: ${others.length}`);
  write('No writes are performed. No PII or secret values are recorded.');
  write('');

  write('=== New tables: anon vs authenticated ===');
  for (const t of ['listings', 'expenses']) {
    const a = await req(`/rest/v1/${t}?${q({ select: '*', limit: 3 })}`);
    const b = await req(`/rest/v1/${t}?${q({ select: '*', limit: 3 })}`, { auth: true, token });
    write(`  ${t.padEnd(12)} anon=${shape(a).padEnd(22)} auth=${shape(b)}`);
  }
  write('');

  write('=== Anonymous column/filter exposure (own identifiers only) ===');
  const anonCases = [
    ['profiles?select=name,role&id=own', `/rest/v1/profiles?${q({ select: 'name,role', id: `eq.${userId}` })}`],
    ['businesses?select=*&user_id=own', `/rest/v1/businesses?${q({ select: '*', user_id: `eq.${userId}` })}`],
    ['subscriptions?select=plan,status,expires_at&business_id=own', `/rest/v1/subscriptions?${q({ select: 'plan,status,expires_at', business_id: `eq.${ownBizId}` })}`],
    ['business_payment_details?select=bank...&business_id=own', `/rest/v1/business_payment_details?${q({ select: 'bank_name,account_name,account_number,payment_instructions', business_id: `eq.${ownBizId}` })}`],
    ['listings?select=*&business_id=own', `/rest/v1/listings?${q({ select: '*', business_id: `eq.${ownBizId}` })}`],
    ['expenses?select=*&business_id=own', `/rest/v1/expenses?${q({ select: '*', business_id: `eq.${ownBizId}` })}`],
  ];
  for (const [label, p] of anonCases) {
    const r = await req(p);
    write(`  ${label.padEnd(56)} ${shape(r)}`);
  }
  write('');

  if (!other) {
    write('No other tenant available for cross-tenant tests.');
  } else {
    const otherId = other.id;
    const otherOwner = other.user_id;

    write('=== Cross-tenant reads (authenticated) ===');
    const cases = [
      ['businesses?select=*&id=other', `/rest/v1/businesses?${q({ select: '*', id: `eq.${otherId}` })}`, ['email', 'address', 'phone', 'user_id', 'trust_signals']],
      ['profiles?select=name,role&id=other_owner', `/rest/v1/profiles?${q({ select: 'name,role', id: `eq.${otherOwner}` })}`, ['name', 'role']],
      ['subscriptions?select=plan,status,expires_at&business_id=other', `/rest/v1/subscriptions?${q({ select: 'plan,status,expires_at', business_id: `eq.${otherId}` })}`, ['plan', 'status', 'expires_at']],
      ['business_payment_details?select=bank...&business_id=other', `/rest/v1/business_payment_details?${q({ select: 'bank_name,account_name,account_number,payment_instructions', business_id: `eq.${otherId}` })}`, ['bank_name', 'account_name', 'account_number', 'payment_instructions']],
      ['listings?select=*&business_id=other', `/rest/v1/listings?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id', 'name', 'price']],
      ['expenses?select=*&business_id=other', `/rest/v1/expenses?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id', 'amount', 'description']],
      ['bookings?select=*&business_id=other', `/rest/v1/bookings?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id']],
      ['customers?select=*&business_id=other', `/rest/v1/customers?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id']],
      ['invoices?select=*&business_id=other', `/rest/v1/invoices?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id']],
      ['messages?select=*&business_id=other', `/rest/v1/messages?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id']],
      ['notifications?select=*&business_id=other', `/rest/v1/notifications?${q({ select: '*', business_id: `eq.${otherId}` })}`, ['id']],
    ];
    for (const [label, p, fields] of cases) {
      const r = await req(p, { auth: true, token });
      const c = count(r);
      let extra = '';
      if (c && c > 0) {
        const b = boolRow(r, fields);
        extra = ' non_null=[' + Object.entries(b).filter(([, v]) => v).map(([k]) => k).join(',') + ']';
      }
      write(`  ${label.padEnd(62)} ${shape(r)}${extra}`);
    }
    write('');

    write('=== RPCs: own vs other tenants (authenticated) ===');
    const ownPulse = await req('/rest/v1/rpc/get_business_pulse', { auth: true, token, method: 'POST', body: { p_business_id: ownBizId, p_period_days: 30 } });
    write(`  get_business_pulse own          ${pulseSummary(ownPulse)}`);
    for (const b of others) {
      const r = await req('/rest/v1/rpc/get_business_pulse', { auth: true, token, method: 'POST', body: { p_business_id: b.id, p_period_days: 30 } });
      write(`  get_business_pulse other        ${pulseSummary(r)}`);
    }
    const ownInv = await req('/rest/v1/rpc/get_inventory_overview', { auth: true, token, method: 'POST', body: { p_business_id: ownBizId, p_status: null, p_search: null, p_limit: 50, p_offset: 0 } });
    write(`  get_inventory_overview own      ${invSummary(ownInv)}`);
    for (const b of others) {
      const r = await req('/rest/v1/rpc/get_inventory_overview', { auth: true, token, method: 'POST', body: { p_business_id: b.id, p_status: null, p_search: null, p_limit: 50, p_offset: 0 } });
      write(`  get_inventory_overview other    ${invSummary(r)}`);
    }
    write('');

    write('=== RPCs: anonymous (other tenant) ===');
    const anonPulse = await req('/rest/v1/rpc/get_business_pulse', { method: 'POST', body: { p_business_id: otherId, p_period_days: 30 } });
    write(`  get_business_pulse other        ${pulseSummary(anonPulse)}`);
    const anonInv = await req('/rest/v1/rpc/get_inventory_overview', { method: 'POST', body: { p_business_id: otherId, p_status: null, p_search: null, p_limit: 50, p_offset: 0 } });
    write(`  get_inventory_overview other    ${invSummary(anonInv)}`);
    write('');

    write('=== Anonymous profile read (other owner id) ===');
    const anonProfile = await req(`/rest/v1/profiles?${q({ select: 'name,role', id: `eq.${otherOwner}` })}`);
    write(`  profiles?select=name,role&id=other_owner  ${shape(anonProfile)}`);
    write('');
  }

  write('=== Interpretation hints ===');
  write('  - 0 rows / 401 / 403 on cross-tenant reads = control held.');
  write('  - rows > 0 on a cross-tenant read or RPC = confirmed cross-tenant exposure.');
  write('  - RPC 200 with has_any_data=true or total/items>0 for another tenant = IDOR.');
  write('  - anon 200 on profiles/subscriptions/business_payment_details/listings/expenses = anonymous exposure.');

  const file = path.join(EVIDENCE_DIR, 'app-logic-probe.txt');
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`\nSaved ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
