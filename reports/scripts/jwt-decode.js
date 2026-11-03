#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SENSITIVE = new Set(['email', 'phone', 'name', 'sub', 'session_id']);

function base64UrlDecode(value) {
  value = value.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) value += '=';
  return Buffer.from(value, 'base64').toString('utf8');
}

function decodeJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return {
    header: JSON.parse(base64UrlDecode(parts[0])),
    payload: JSON.parse(base64UrlDecode(parts[1])),
    signature: parts[2],
  };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE.has(key.toLowerCase()) ? '<redacted>' : redact(item),
    ]));
  }
  return value;
}

function main() {
  const sessionPath = path.join(__dirname, 'session.json');
  if (!fs.existsSync(sessionPath)) {
    console.log('session.json not found');
    return;
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  console.log('=== Session Info ===\n');
  console.log('Keys:', Object.keys(session));
  console.log('Refresh token present:', Boolean(session.refresh_token));
  console.log('');

  if (session.access_token) {
    const decoded = decodeJWT(session.access_token);
    console.log('=== Access Token (JWT, PII redacted) ===\n');
    console.log('Header:', JSON.stringify(decoded.header, null, 2));
    console.log('\nPayload:', JSON.stringify(redact(decoded.payload), null, 2));
    console.log('\nSignature length:', decoded.signature.length);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
