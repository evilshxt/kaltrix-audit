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

function enc(p) {
  return p.split('/').map(encodeURIComponent).join('/');
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

async function listObjects(auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (!auth) headers.Authorization = `Bearer ${anonKey}`;
  return request('POST', '/storage/v1/object/list/logos', {
    body: { prefix: '', limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } },
    headers,
    auth,
  });
}

async function removeObject(p, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (!auth) headers.Authorization = `Bearer ${anonKey}`;
  let r = await request('DELETE', '/storage/v1/object/logos', {
    body: { prefixes: [p] },
    headers,
    auth,
  });
  if (r.status >= 200 && r.status < 300) return r;
  return request('DELETE', `/storage/v1/object/logos/${enc(p)}`, { headers, auth });
}

(async () => {
  log('KaltrixOS anonymous/auth storage access probe');
  log(`Run: ${new Date().toISOString()}`);
  log(`Project host: ${base.hostname}`);
  log(`Test user: ${userId}`);
  log('');

  log('Bucket metadata:');
  for (const [label, auth] of [['anon', false], ['auth', true]]) {
    const headers = auth ? {} : { Authorization: `Bearer ${anonKey}` };
    const r = await request('GET', '/storage/v1/bucket/logos', { headers, auth });
    log(`  ${label}: HTTP ${r.status} ${r.status === 200 ? `public=${r.json.public} size_limit=${r.json.file_size_limit} mime=${JSON.stringify(r.json.allowed_mime_types)}` : err(r)}`);
  }
  log('');

  log('Object list (root, limit 100):');
  for (const [label, auth] of [['auth', true], ['anon', false]]) {
    const r = await listObjects(auth);
    if (r.status === 200 && Array.isArray(r.json)) {
      const names = r.json.map(o => String(o.name || ''));
      const own = names.filter(n => n.startsWith(`${userId}-`) || n.startsWith(`${userId}/`)).length;
      log(`  ${label}: HTTP 200, objects=${names.length}, own_prefix=${own} (names not printed)`);
    } else {
      log(`  ${label}: HTTP ${r.status} ${err(r)}`);
    }
  }
  log('');

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const anonPath = `anon-security-test-${Date.now()}.png`;
  log(`Anonymous upload test: logos/${anonPath} (${tinyPng.length} bytes, image/png)`);
  const anonUpload = await request('POST', `/storage/v1/object/logos/${enc(anonPath)}`, {
    body: tinyPng,
    headers: {
      'Content-Type': 'image/png',
      'cache-control': '3600',
      'x-upsert': 'false',
      Authorization: `Bearer ${anonKey}`,
    },
    auth: false,
  });
  if (anonUpload.status >= 200 && anonUpload.status < 300) {
    log(`  [CONFIRMED] anonymous upload accepted: HTTP ${anonUpload.status}`);
    let d = await removeObject(anonPath, false);
    log(`  cleanup delete (anon): HTTP ${d.status} ${d.status >= 200 && d.status < 300 ? '(deleted)' : err(d)}`);
    if (!(d.status >= 200 && d.status < 300)) {
      d = await removeObject(anonPath, true);
      log(`  cleanup delete (auth): HTTP ${d.status} ${d.status >= 200 && d.status < 300 ? '(deleted)' : err(d)}`);
    }
  } else {
    log(`  [BLOCKED] anonymous upload denied: HTTP ${anonUpload.status} ${err(anonUpload)}`);
  }
  log('');

  log('Limitations: no other tenant object was read, overwritten, or deleted.');
  log('The anonymous upload test object is a 1x1 PNG and was deleted if the API allowed it.');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'storage-access-probe.txt'), lines.join('\n') + '\n', 'utf8');
  console.log('\nEvidence written to reports/evidence/storage-access-probe.txt');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
