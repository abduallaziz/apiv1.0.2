// Classifies spec files: any spec that talks to a real Supabase/Postgres is a
// DB-backed (integration/regression) spec and is excluded from `npm test`.
// Detected by content, so new DB specs are classified automatically.
const fs = require('fs');
const path = require('path');

const MARKERS = [
  'createClient(',
  'process.env.SUPABASE',
  'process.env.DATABASE_URL',
  "process.env['SUPABASE",
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.spec\.ts$/.test(e.name)) out.push(p);
  }
}

function findDbSpecs(apiRoot) {
  const all = [];
  walk(path.join(apiRoot, 'src'), all);
  return all
    .filter((f) => {
      const t = fs.readFileSync(f, 'utf8');
      return MARKERS.some((m) => t.includes(m));
    })
    .map((f) => path.relative(apiRoot, f).split(path.sep).join('/'))
    .sort();
}

module.exports = { findDbSpecs, MARKERS };
