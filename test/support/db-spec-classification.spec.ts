import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findDbSpecs } = require('./db-specs');

const ROOT = path.resolve(__dirname, '..', '..');
const dbSpecs: string[] = findDbSpecs(ROOT);

describe('DB-backed spec hygiene', () => {
  it('finds the DB-backed specs (and the default unit config excludes them)', () => {
    expect(dbSpecs.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../jest.config.js');
    for (const p of dbSpecs) {
      expect(
        cfg.testPathIgnorePatterns.some((re: string) => new RegExp(re).test(p)),
      ).toBe(true);
    }
  });

  it('no DB spec picks "the first" tenant/warehouse without a tenant filter', () => {
    const offenders: string[] = [];
    for (const rel of dbSpecs) {
      const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\.from\('(warehouses|tenants)'\)/.test(line)) return;
        const window = lines.slice(i, i + 8).join('\n');
        const pickFirst = /\.limit\(1\)/.test(window);
        const scoped = /\.eq\('tenant_id'|\.neq\(|\.eq\('id'/.test(window);
        if (pickFirst && !scoped) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no DB spec hard-codes the production project in code', () => {
    const offenders = dbSpecs.filter((rel) =>
      /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(
        fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
