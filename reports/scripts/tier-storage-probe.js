#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const CRED_DIR = path.join(REPO, 'reports', 'credentials');
const EVIDENCE_DIR = path.join(REPO, 'reports', 'evidence');
const SESSION_PATH = path.join(__dirname, 'session.json');
const LOGO_PATH = path.join(REPO, 'personal', 'image.png');

const secrets = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'secrets.json'), 'utf8'));
const projectUrl = secrets.secrets.find(s => s.type === 'supabase_project_url').value;
const anonKey = secrets.secrets.find(s => s.type === 'supabase_anon_key').value;
const base = new URL(projectUrl);
const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
const accessToken = session.access_token;
const userId = session.user.id;
const lines = [];

function log(msg) {
  lines.push(msg);
  console.log(msg);
}

function q(s) {
  return encodeURIComponent(s);
}

function enc(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function publicUrl(p) {
  return `${projectUrl.replace(/\/$/, '')}/storage/v1/object/public/logos/${enc(p)}`;
}

function request(method, pathName, { body, headers = {}, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) data = body;
      else if (typeof body === 'string') data = Buffer.from(body, 'utf8');
      else data = Buffer.from(JSON.stringify(body), 'utf8');
    }
    const h = { apikey: anonKey, ...headers };
    if (auth) h.Authorization = `Bearer ${accessToken}`;
    if (data) h['Content-Length'] = data.length;
    const req = https.request({ hostname: base.hostname, port: 443, path: pathName, method, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function err(r) {
  const raw = (r.json && (r.json.message || r.json.error_description || r.json.error)) || r.text || '';
  return String(raw).replace(/\s+/g, ' ').slice(0, 220);
}

async function uploadObject(p, buf, contentType) {
  return request('POST', `/storage/v1/object/logos/${enc(p)}`, {
    body: buf,
    headers: {
      'Content-Type': contentType,
      'cache-control': '3600',
      'x-upsert': 'false',
    },
  });
}

async function removeObject(p) {
  let r = await request('DELETE', '/storage/v1/object/logos', {
    body: { prefixes: [p] },
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.status >= 200 && r.status < 300) return r;
  return request('DELETE', `/storage/v1/object/logos/${enc(p)}`);
}

async function getSubscription(id) {
  return request('GET', `/rest/v1/subscriptions?select=id,plan,status,expires_at,trial_started_at,paystack_reference&id=eq.${q(id)}`);
}

(async () => {
  log('KaltrixOS tier/storage probe (authorized test account only)');
  log(`Run: ${new Date().toISOString()}`);
  log(`Project host: ${base.hostname}`);
  log(`Test user: ${userId}`);
  log('');

  let r = await request('GET', `/rest/v1/businesses?select=id,business_name,industry,city,description,logo_url,phone,email,website_url,address,slug&user_id=eq.${q(userId)}`);
  if (r.status !== 200 || !Array.isArray(r.json) || r.json.length !== 1) {
    log(`[ABORT] could not read own business: HTTP ${r.status} ${err(r)}`);
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'tier-storage-probe.txt'), lines.join('\n') + '\n');
    process.exit(1);
  }
  const business = r.json[0];
  log('Own business (safe fields):');
  for (const k of ['business_name', 'industry', 'city', 'description', 'logo_url', 'phone', 'website_url', 'slug']) {
    log(`  ${k}: ${business[k] === null || business[k] === '' ? '(empty)' : business[k]}`);
  }
  log(`  email: ${business.email ? '(set)' : '(empty)'}`);
  log(`  address: ${business.address ? '(set)' : '(empty)'}`);
  log('');

  r = await request('GET', `/rest/v1/subscriptions?select=id,business_id,plan,status,expires_at,trial_started_at,paystack_reference,created_at,updated_at&business_id=eq.${q(business.id)}`);
  if (r.status !== 200 || !Array.isArray(r.json) || r.json.length !== 1) {
    log(`[WARN] could not read own subscription: HTTP ${r.status} ${err(r)}`);
  } else {
    const sub = r.json[0];
    log('Own subscription:');
    log(`  plan: ${sub.plan}`);
    log(`  status: ${sub.status}`);
    log(`  expires_at: ${sub.expires_at}`);
    log(`  trial_started_at: ${sub.trial_started_at}`);
    log(`  paystack_reference: ${sub.paystack_reference ? '(set)' : '(null)'}`);
    log('');

    const original = {
      plan: sub.plan,
      status: sub.status,
      expires_at: sub.expires_at,
      trial_started_at: sub.trial_started_at,
      paystack_reference: sub.paystack_reference,
    };
    const altPlan = sub.plan === 'growth' ? 'free' : 'growth';
    log(`Subscription write test: PATCH plan ${sub.plan} -> ${altPlan} (then restore)`);
    const w = await request('PATCH', `/rest/v1/subscriptions?id=eq.${q(sub.id)}`, {
      body: { plan: altPlan },
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    });
    const rows = Array.isArray(w.json) ? w.json.length : 0;
    let confirmed = false;
    if (w.status >= 200 && w.status < 300) {
      if (rows === 1) confirmed = w.json[0].plan === altPlan;
      else {
        const g = await getSubscription(sub.id);
        confirmed = g.status === 200 && Array.isArray(g.json) && g.json.length === 1 && g.json[0].plan === altPlan;
      }
    }
    if (confirmed) {
      log(`[CONFIRMED] plan update accepted: HTTP ${w.status}, rows=${rows}, new plan=${altPlan}`);
      log('  An authenticated owner can write subscriptions.plan directly.');
    } else {
      log(`[BLOCKED] plan update not applied: HTTP ${w.status}, rows=${rows} ${err(w)}`);
    }

    let restore = await request('PATCH', `/rest/v1/subscriptions?id=eq.${q(sub.id)}`, {
      body: { plan: original.plan },
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    });
    let restoreRows = Array.isArray(restore.json) ? restore.json.length : 0;
    let restoreOk = restore.status >= 200 && restore.status < 300 && restoreRows === 1 && restore.json[0].plan === original.plan;
    log(`  restore plan -> ${original.plan}: HTTP ${restore.status}, rows=${restoreRows}`);
    if (!restoreOk) {
      log('  [WARN] restore did not confirm; retrying full original row');
      restore = await request('PATCH', `/rest/v1/subscriptions?id=eq.${q(sub.id)}`, {
        body: original,
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      });
      restoreRows = Array.isArray(restore.json) ? restore.json.length : 0;
      log(`  full restore: HTTP ${restore.status}, rows=${restoreRows}`);
    }

    const check = await getSubscription(sub.id);
    if (check.status === 200 && Array.isArray(check.json) && check.json.length === 1) {
      const c = check.json[0];
      const same = c.plan === original.plan
        && c.status === original.status
        && c.expires_at === original.expires_at
        && c.trial_started_at === original.trial_started_at
        && c.paystack_reference === original.paystack_reference;
      log(`  post-restore row matches original: ${same ? 'yes' : 'NO'}`);
      if (!same) log('  [WARN] subscription fields changed unexpectedly; manual review required.');
    }

    if (confirmed) {
      log('  Same-value no-op update to paystack_reference (does not change value):');
      const noop = await request('PATCH', `/rest/v1/subscriptions?id=eq.${q(sub.id)}`, {
        body: { paystack_reference: original.paystack_reference },
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      });
      const noopRows = Array.isArray(noop.json) ? noop.json.length : 0;
      log(`    HTTP ${noop.status}, rows=${noopRows} ${noopRows === 1 ? '(column writable)' : err(noop)}`);
    }
    log('');
  }

  r = await request('GET', '/storage/v1/bucket/logos');
  if (r.status === 200 && r.json) {
    log('Storage bucket logos config:');
    log(`  public: ${r.json.public}`);
    log(`  file_size_limit: ${r.json.file_size_limit}`);
    log(`  allowed_mime_types: ${JSON.stringify(r.json.allowed_mime_types)}`);
  } else {
    log(`[WARN] bucket config not readable: HTTP ${r.status} ${err(r)}`);
  }
  log('');

  r = await request('POST', '/storage/v1/object/list/logos', {
    body: { prefix: '', limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } },
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.status === 200 && Array.isArray(r.json)) {
    const names = r.json.map(o => String(o.name || ''));
    const own = names.filter(n => n.startsWith(`${userId}-`) || n.startsWith(`${userId}/`)).length;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-./]/i;
    const other = names.filter(n => uuidRe.test(n) && !(n.startsWith(`${userId}-`) || n.startsWith(`${userId}/`))).length;
    log(`Storage list: HTTP 200, objects=${names.length}, own_prefix=${own}, other_uuid_prefix=${other}`);
    log('  (names not printed; count-only)');
  } else {
    log(`Storage list: HTTP ${r.status} ${err(r)}`);
  }
  log('');

  const image = fs.readFileSync(LOGO_PATH);
  const logoPath = `${userId}-${Date.now()}.png`;
  log(`Uploading assessment logo to logos/${logoPath} (${image.length} bytes, image/png)`);
  const up = await uploadObject(logoPath, image, 'image/png');
  if (up.status >= 200 && up.status < 300) {
    log(`[OK] logo upload accepted: HTTP ${up.status}`);
    const pub = await request('GET', `/storage/v1/object/public/logos/${enc(logoPath)}`, { auth: false });
    log(`  public read: HTTP ${pub.status}, content-type=${pub.headers['content-type'] || '(none)'}, length=${pub.headers['content-length'] || '(none)'}`);
    const patch = { logo_url: publicUrl(logoPath) };
    for (const [k, v] of Object.entries({
      industry: 'Technology',
      city: 'Lagos',
      description: 'Authorized security assessment test business profile.',
      phone: '+2340000000000',
      email: 'security-test@example.com',
      website_url: 'https://example.com',
      address: 'Test Address, Lagos, Nigeria',
    })) {
      if (business[k] === null || business[k] === '') patch[k] = v;
    }
    const fields = Object.keys(patch);
    log(`  updating own business fields: ${fields.join(', ')}`);
    const bu = await request('PATCH', `/rest/v1/businesses?id=eq.${q(business.id)}`, {
      body: patch,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    });
    const buRows = Array.isArray(bu.json) ? bu.json.length : 0;
    if (bu.status >= 200 && bu.status < 300 && buRows === 1) {
      log(`[OK] business update accepted: HTTP ${bu.status}, logo_url set=${!!bu.json[0].logo_url}`);
      business.logo_url = bu.json[0].logo_url;
      for (const k of fields) business[k] = bu.json[0][k];
    } else {
      log(`[WARN] business update failed: HTTP ${bu.status}, rows=${buRows} ${err(bu)}`);
    }
  } else {
    log(`[WARN] logo upload rejected: HTTP ${up.status} ${err(up)}`);
  }
  log('');

  const ts = Date.now();
  const tests = [
    { name: 'text/plain', path: `${userId}-security-test-${ts}.txt`, body: Buffer.from('security test\n'), ct: 'text/plain' },
    { name: 'text/html', path: `${userId}-security-test-${ts}.html`, body: Buffer.from('<h1>security test</h1>\n'), ct: 'text/html' },
    { name: 'image/svg+xml', path: `${userId}-security-test-${ts}.svg`, body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="10">security test</text></svg>\n'), ct: 'image/svg+xml' },
  ];
  for (const t of tests) {
    log(`MIME test ${t.name} -> ${t.path}`);
    const u = await uploadObject(t.path, t.body, t.ct);
    if (u.status >= 200 && u.status < 300) {
      log(`  [ACCEPTED] HTTP ${u.status}`);
      const pub = await request('GET', `/storage/v1/object/public/logos/${enc(t.path)}`, { auth: false });
      log(`  public read: HTTP ${pub.status}, content-type=${pub.headers['content-type'] || '(none)'}`);
      const d = await removeObject(t.path);
      log(`  cleanup delete: HTTP ${d.status} ${d.status >= 200 && d.status < 300 ? '(deleted)' : err(d)}`);
    } else {
      log(`  [REJECTED] HTTP ${u.status} ${err(u)}`);
    }
  }
  log('');

  const unprefixed = `security-test-${Date.now()}.png`;
  log(`Path-prefix test: upload with no user-ID prefix -> ${unprefixed}`);
  const pu = await uploadObject(unprefixed, image, 'image/png');
  if (pu.status >= 200 && pu.status < 300) {
    log(`  [ACCEPTED] HTTP ${pu.status} (bucket does not require the uploader user-ID prefix)`);
    const d = await removeObject(unprefixed);
    log(`  cleanup delete: HTTP ${d.status} ${d.status >= 200 && d.status < 300 ? '(deleted)' : err(d)}`);
  } else {
    log(`  [REJECTED] HTTP ${pu.status} ${err(pu)} (prefix enforcement may be present)`);
  }
  log('');

  log('Limitations: cross-tenant storage overwrite/delete was not attempted; no other tenant object was touched.');
  log('All writes were on the authorized test account/business and its own uploaded objects.');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'tier-storage-probe.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('\nEvidence written to reports/evidence/tier-storage-probe.txt');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
