#!/usr/bin/env node
/**
 * Strips credentials out of k6 output before it is published as a CI artifact.
 *
 * Why this is necessary: `k6 run --summary-export` embeds the value returned by
 * the script's setup() function under a `setup_data` key. Our setup() returns
 * the logged-in sessions so the VUs can share them, which means the exported
 * summary contains **live JWT access tokens** and the account email. A workflow
 * artifact is downloadable by anyone with read access to the repository and is
 * retained for weeks, so uploading that file verbatim would publish working
 * credentials for the target environment.
 *
 * GitHub's secret masking does not help here. It only redacts values that were
 * configured as secrets, and only in the live log view — a token minted at
 * runtime is not a configured secret, and files written by `tee` are never
 * passed through the masker at all.
 *
 * What this does:
 *   1. Drops `setup_data` from the summary outright.
 *   2. Redacts any key that looks credential-bearing, at any depth.
 *   3. Redacts the literal values passed via REDACT_VALUES (the API URL and
 *      account email, which are configured as secrets and can otherwise appear
 *      verbatim in k6 error text).
 *   4. Fails loudly if anything JWT-shaped survives, so a future change to the
 *      test scripts cannot silently reintroduce a leak.
 *
 * Usage:
 *   node sanitize-results.js <input> <output>
 *
 * Env:
 *   REDACT_VALUES  newline-separated literals to scrub from the content
 *
 * Both JSON and plain-text inputs are supported; the file is parsed as JSON
 * when possible and treated as text otherwise.
 */

'use strict';

const fs = require('fs');

const REDACTED = '[REDACTED]';

// Matched case-insensitively against object keys.
const SENSITIVE_KEY = /(token|password|secret|authorization|apikey|api_key|cookie)/i;

// Three dot-separated base64url segments — a JWT. Also catches the refresh
// tokens minted as 128-char hex by auth.service.ts via the second alternative.
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/;
const LONG_HEX = /\b[a-f0-9]{64,}\b/i;

function literalsToRedact() {
  return (process.env.REDACT_VALUES || '')
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v.length >= 4); // too short to redact safely
}

function redactLiterals(text, literals) {
  let out = text;
  for (const literal of literals) {
    // Escape regex metacharacters — URLs contain '/', '.', '?' and friends.
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), REDACTED);
  }
  return out;
}

function scrubJson(node) {
  if (Array.isArray(node)) {
    return node.map(scrubJson);
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubJson(value);
    }
    return out;
  }
  return node;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: sanitize-results.js <input> <output>');
    process.exit(2);
  }
  if (!fs.existsSync(input)) {
    console.error('sanitize: input does not exist: ' + input);
    process.exit(2);
  }

  const literals = literalsToRedact();
  const raw = fs.readFileSync(input, 'utf8');

  let result;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    // setup_data is the specific k6 leak vector — remove it wholesale rather
    // than relying on key-name matching to catch everything inside it.
    if ('setup_data' in parsed) {
      delete parsed.setup_data;
      console.log('sanitize: removed setup_data (contained session tokens)');
    }
    result = redactLiterals(JSON.stringify(scrubJson(parsed), null, 2), literals);
  } else {
    result = redactLiterals(raw, literals);
  }

  // Fail closed. If something credential-shaped is still present, the artifact
  // must not be written at all — a failed CI step is far cheaper than a leaked
  // token sitting in a downloadable artifact.
  if (JWT_SHAPED.test(result)) {
    console.error('sanitize: FAILED — JWT-shaped string still present in ' + input);
    process.exit(1);
  }
  if (LONG_HEX.test(result)) {
    console.error('sanitize: FAILED — long hex string (possible token) present in ' + input);
    process.exit(1);
  }

  fs.writeFileSync(output, result);
  console.log('sanitize: wrote ' + output + ' (' + result.length + ' bytes)');
}

main();
