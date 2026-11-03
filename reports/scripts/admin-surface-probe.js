#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://kaltrixos.com';
const SESSION = path.join(__dirname, 'session.json');

function getCookie(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  return `sb-fgkdkyhnokijbxyxcgug-auth-token=${value}`;
}

function request(pathname, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'KaltrixOS-security-audit' };
    if (cookie) headers.Cookie = cookie;
    const req = https.request({
      hostname: 'kaltrixos.com',
      path: pathname,
      method: 'GET',
      headers,
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location || '',
        contentType: res.headers['content-type'] || '',
        bodyLength: body.length,
        title: (body.match(/<title>([^<]*)<\/title>/) || [])[1] || '',
        loginForm: body.includes('Welcome back'),
        dashboardShell: body.includes('Dashboard'),
        adminHints: /\b(approve|verify|suspend|payout|impersonate)\b/i.test(body),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  let cookie = '';
  if (fs.existsSync(SESSION)) {
    const session = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
    cookie = getCookie(session);
    console.log(`Loaded local session; SSR cookie length: ${cookie.length} bytes\n`);
  } else {
    console.log('No local session.json; only unauthenticated requests will run.\n');
  }

  const routes = [
    '/admin',
    '/dashboard/admin',
    '/dashboard',
    '/api/admin',
    '/_next/data/dashboard/admin.json',
  ];

  for (const [label, currentCookie] of [['Unauthenticated', ''], ['Authenticated (SSR cookie)', cookie]]) {
    if (label.startsWith('Authenticated') && !currentCookie) continue;
    console.log(`--- ${label} ---\n`);
    for (const route of routes) {
      try {
        const r = await request(route, currentCookie);
        console.log(`${route}`);
        console.log(`  Status: ${r.status}`);
        console.log(`  Location: ${r.location || '(none)'}`);
        console.log(`  Content-Type: ${r.contentType || '(none)'}`);
        console.log(`  Body length: ${r.bodyLength}`);
        console.log(`  Title: ${r.title || '(none)'}`);
        console.log(`  Login form: ${r.loginForm ? 'YES' : 'NO'}`);
        console.log(`  Dashboard shell: ${r.dashboardShell ? 'YES' : 'NO'}`);
        console.log(`  Admin hints: ${r.adminHints ? 'YES' : 'NO'}`);
        console.log('');
      } catch (err) {
        console.log(`${route}: Error - ${err.message}\n`);
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
