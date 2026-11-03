#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const CRED_DIR = path.join(REPO, 'reports', 'credentials');
const EVIDENCE_DIR = path.join(REPO, 'reports', 'evidence');
const SESSION_PATH = path.join(__dirname, 'session.json');

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

function request(method, pathName, { body, headers = {}, auth = true, hostname = base.hostname, port = 443 } = {}) {
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
    const req = https.request({ hostname, port, path: pathName, method, headers: h }, res => {
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

(async () => {
  log('KaltrixOS business setup check (authorized test account only)');
  log(`Run: ${new Date().toISOString()}`);
  log(`Project host: ${base.hostname}`);
  log(`Test user: ${userId}`);
  log('');

  let r = await request('GET', `/rest/v1/businesses?select=id,business_name,slug,logo_url,email,address,industry,city,phone,website_url&user_id=eq.${q(userId)}`);
  if (r.status !== 200 || !Array.isArray(r.json) || r.json.length !== 1) {
    log(`[ABORT] could not read own business: HTTP ${r.status} ${err(r)}`);
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'business-setup-check.txt'), lines.join('\n') + '\n');
    process.exit(1);
  }
  let business = r.json[0];
  log('Own business before:');
  log(`  business_name: ${business.business_name}`);
  log(`  slug: ${business.slug || '(empty)'}`);
  log(`  logo_url: ${business.logo_url ? '(set)' : '(empty)'}`);
  log(`  email: ${business.email ? '(set)' : '(empty)'}`);
  log(`  address: ${business.address ? '(set)' : '(empty)'}`);
  log('');

  const candidates = ['kaltrix-labs-assessment', `kaltrix-labs-${Math.random().toString(36).slice(2, 10)}`];
  let slugToUse = business.slug;
  if (!slugToUse) {
    for (const candidate of candidates) {
      const taken = await request('GET', `/rest/v1/businesses?select=id&slug=eq.${q(candidate)}`, { auth: false });
      const count = taken.status === 200 && Array.isArray(taken.json) ? taken.json.length : -1;
      log(`Slug candidate ${candidate}: HTTP ${taken.status}, matches=${count}`);
      if (taken.status === 200 && count === 0) {
        const u = await request('PATCH', `/rest/v1/businesses?id=eq.${q(business.id)}`, {
          body: { slug: candidate },
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        });
        const rows = Array.isArray(u.json) ? u.json.length : 0;
        if (u.status >= 200 && u.status < 300 && rows === 1) {
          slugToUse = u.json[0].slug;
          log(`[OK] slug set: HTTP ${u.status}, slug=${slugToUse}`);
          business = { ...business, ...u.json[0] };
          break;
        }
        log(`[WARN] slug update failed: HTTP ${u.status}, rows=${rows} ${err(u)}`);
      }
    }
  }
  if (!slugToUse) {
    log('[WARN] business has no slug; public page cannot be verified.');
  }
  log('');

  // anon app-discover fields
  r = await request('GET', `/rest/v1/businesses?select=business_name,slug,logo_url&id=eq.${q(business.id)}`, { auth: false });
  if (r.status === 200 && Array.isArray(r.json) && r.json.length === 1) {
    const a = r.json[0];
    log('Anonymous app-discover read:');
    log(`  business_name: ${a.business_name}`);
    log(`  slug: ${a.slug || '(empty)'}`);
    log(`  logo_url: ${a.logo_url ? '(set)' : '(empty)'}`);
  } else {
    log(`Anonymous app-discover read: HTTP ${r.status} ${err(r)}`);
  }
  log('');

  // anon email/address exposure on this test business (presence only)
  r = await request('GET', `/rest/v1/businesses?select=email,address&id=eq.${q(business.id)}`, { auth: false });
  if (r.status === 200 && Array.isArray(r.json) && r.json.length === 1) {
    const a = r.json[0];
    log('Anonymous email/address read on test business (KAL-AC-001):');
    log(`  HTTP 200, rows=1, email_present=${!!a.email}, address_present=${!!a.address}`);
  } else {
    log(`Anonymous email/address read on test business: HTTP ${r.status} ${err(r)}`);
  }
  log('');

  // public page
  if (slugToUse) {
    const pagePath = `/business/${encodeURIComponent(slugToUse)}`;
    const page = await request('GET', pagePath, {
      auth: false,
      hostname: 'kaltrixos.com',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; authorized-security-assessment)', Accept: 'text/html' },
    });
    log(`Public page GET ${pagePath}: HTTP ${page.status}, bytes=${Buffer.byteLength(page.text || '')}`);
    if (page.status === 200) {
      const hasName = page.text.includes(business.business_name);
      const hasLogo = !!business.logo_url && page.text.includes(business.logo_url.split('/').pop());
      const hasLogoHost = page.text.includes('/storage/v1/object/public/logos/');
      log(`  contains business name: ${hasName}`);
      log(`  contains logo object path: ${hasLogo || hasLogoHost}`);
    } else {
      log(`  ${err(page)}`);
    }
    log('');
  }

  log('Limitations: no browser automation; public-page check is an unauthenticated HTTP fetch.');
  log('All writes were on the authorized test account/business.');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'business-setup-check.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('\nEvidence written to reports/evidence/business-setup-check.txt');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
