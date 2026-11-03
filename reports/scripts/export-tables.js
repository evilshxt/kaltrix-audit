#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'database-exports');
const CRED_DIR = path.join(ROOT, 'credentials');
const creds = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'credentials.json'), 'utf8'));
const secrets = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'secrets.json'), 'utf8'));
const projectUrl = secrets.secrets.find(s => s.type === 'supabase_project_url').value;
const anon = secrets.secrets.find(s => s.type === 'supabase_anon_key').value;
const base = new URL(projectUrl);

function req(pathName, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({ apikey: anon, Accept: 'application/json' }, headers);
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

(async () => {
  const login = await req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: creds.email, password: creds.password } });
  const session = parse(login);
  if (!session || !session.access_token) {
    console.error('Login failed', login.status, login.body.slice(0, 200));
    process.exit(1);
  }
  const authHeaders = { Authorization: `Bearer ${session.access_token}` };
  const userId = session.user.id;
  fs.mkdirSync(OUT, { recursive: true });

  const tables = [
    'businesses', 'profiles', 'subscriptions', 'leads', 'customers', 'bookings',
    'invoices', 'messages', 'notifications', 'inventory_items', 'business_payment_details',
    'email_logs', 'feedback', 'reviews', 'listings', 'expenses', 'rate_limits',
  ];

  const selectFor = (t) => {
    if (t === 'businesses') return 'id,business_name,industry,city,phone,website_url,trust_score,is_verified,slug,logo_url,description,created_at';
    if (t === 'profiles') return 'id,name,email,role,created_at';
    if (t === 'subscriptions') return 'id,business_id,plan,status,created_at,updated_at,expires_at,trial_started_at';
    if (t === 'reviews') return 'id,business_id,rating,created_at';
    if (t === 'listings') return 'id,business_id,price,is_active,created_at';
    if (t === 'expenses') return 'id,business_id,expense_date,created_at';
    if (t === 'business_payment_details') return 'business_id';
    if (t === 'customers') return 'id,business_id,created_at';
    if (t === 'bookings') return 'id,business_id,status,created_at';
    if (t === 'invoices') return 'id,business_id,status,created_at';
    if (t === 'messages') return 'id,business_id,created_at';
    if (t === 'notifications') return 'id,business_id,type,created_at,read_at';
    if (t === 'inventory_items') return 'business_id';
    if (t === 'leads') return 'id,created_at';
    if (t === 'email_logs') return 'id,created_at';
    if (t === 'feedback') return 'id,created_at';
    return '*';
  };
  const filtersFor = (t) => {
    if (t === 'profiles') return `&id=eq.${userId}`;
    return '&limit=1000';
  };
  const noteFor = (t) => {
    if (t === 'businesses') return 'Only public/discover columns exported. email, address, user_id, trust_signals intentionally omitted. phone is publicly displayed by the app.';
    if (t === 'profiles') return 'Own profile only; name and email masked.';
    if (t === 'subscriptions') return 'Own subscription only; paystack_reference omitted.';
    if (t === 'reviews') return 'Authenticated users can read reviews for other businesses. comment and reviewer_name omitted; reviewer_email denied. business_id retained as an internal identifier.';
    if (t === 'listings') return 'Authenticated users can read listings for other businesses. Only catalog metadata exported; name, description, image_url omitted.';
    if (t === 'expenses') return 'Financial table; amount, description, vendor, category, receipt_url omitted.';
    if (t === 'business_payment_details') return 'Bank details omitted; only structural identifiers exported.';
    if (['customers', 'bookings', 'invoices', 'messages', 'notifications', 'inventory_items', 'leads', 'email_logs', 'feedback'].includes(t)) return 'PII/content columns omitted; only structural fields exported.';
    if (t === 'rate_limits') return 'Access denied (403) to the authenticated test user; no rows.';
    return 'Full rows exported only if present; table was empty at export time.';
  };

  const results = [];
  for (const t of tables) {
    const sel = selectFor(t);
    const filt = filtersFor(t);
    const authRes = await req(`/rest/v1/${t}?select=${encodeURIComponent(sel)}${filt}`, { headers: authHeaders });
    const anonSel = t === 'businesses'
      ? 'id,business_name,industry,city,phone,website_url,trust_score,is_verified,slug,logo_url,description'
      : t === 'profiles' ? 'id' : sel;
    const anonRes = await req(`/rest/v1/${t}?select=${encodeURIComponent(anonSel)}&limit=5`);
    const authRows = parse(authRes);
    const anonRows = parse(anonRes);
    let rows = Array.isArray(authRows) ? authRows : [];
    const redacted = [];
    if (t === 'businesses') redacted.push('email', 'address', 'user_id', 'trust_signals');
    if (t === 'profiles') {
      rows = rows.map(r => Object.assign({}, r, {
        name: r.name ? r.name.replace(/^(.).*$/, '$1***') : r.name,
        email: r.email ? r.email.replace(/^(.).*@(.*)$/, '$1***@***') : r.email,
      }));
      redacted.push('name (masked)', 'email (masked)');
    }
    if (t === 'subscriptions') redacted.push('paystack_reference');
    if (t === 'reviews') redacted.push('comment', 'reviewer_name', 'reviewer_email (denied by column grant)');
    if (t === 'listings') redacted.push('name', 'description', 'image_url');
    if (t === 'expenses') redacted.push('amount', 'description', 'vendor', 'category', 'receipt_url');
    if (t === 'business_payment_details') redacted.push('bank_name', 'account_name', 'account_number', 'payment_instructions');
    if (t === 'customers') redacted.push('name', 'email', 'phone', 'address', 'notes');
    if (t === 'bookings') redacted.push('customer_name', 'customer_email', 'customer_phone', 'notes');
    if (t === 'invoices') redacted.push('customer_name', 'customer_email', 'line_items', 'notes');
    if (t === 'messages') redacted.push('content', 'sender', 'recipient');
    if (t === 'notifications') redacted.push('title', 'body', 'href');
    if (t === 'inventory_items') redacted.push('name', 'sku', 'cost', 'supplier', 'notes');
    if (t === 'leads') redacted.push('name', 'email', 'phone', 'message');
    if (t === 'email_logs') redacted.push('recipient', 'subject', 'body');
    if (t === 'feedback') redacted.push('content', 'email');
    const out = {
      engagement: 'kaltrixos-security-audit',
      target: 'https://kaltrixos.com/',
      table: t,
      exported_at: new Date().toISOString(),
      accessed_as: 'authenticated test user',
      anon_status: anonRes.status,
      anon_rows_sample: Array.isArray(anonRows) ? anonRows.length : null,
      auth_status: authRes.status,
      row_count: rows.length,
      columns_exported: rows[0] ? Object.keys(rows[0]) : [],
      redacted_columns: redacted,
      redaction_notes: noteFor(t),
      rows,
    };
    if (!Array.isArray(authRows)) out.access_note = authRows && authRows.message ? authRows.message : authRes.body.slice(0, 200);
    fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
    results.push({ table: t, auth_status: authRes.status, anon_status: anonRes.status, rows: rows.length });
    console.log(`${t.padEnd(28)} auth=${authRes.status} anon=${anonRes.status} rows=${rows.length}`);
  }

  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify({
    engagement: 'kaltrixos-security-audit',
    target: 'https://kaltrixos.com/',
    exported_at: new Date().toISOString(),
    note: 'One JSON file per table. Sensitive fields are redacted per the engagement rules.',
    tables: results,
  }, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${tables.length} table exports + _index.json to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
