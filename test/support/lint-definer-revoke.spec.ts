// DEFINER_WITHOUT_REVOKE (R-FN): a SECURITY DEFINER function that trusts its arguments is callable with the public anon
// key unless the migration revokes EXECUTE from PUBLIC/anon/authenticated. The lint requires a REVOKE naming the function.
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lintSql } = require('../../scripts/lint-migrations.js') as {
  lintSql: (sql: string, file?: string) => { rule: string; line: number; message: string }[];
};

const rules = (sql: string) => lintSql(sql).map((v) => v.rule);
const NL = '\n';
const fn = (extra = '') =>
  'CREATE OR REPLACE FUNCTION public.fn_risky(p_tenant_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;' +
  extra;

describe('migration lint: DEFINER_WITHOUT_REVOKE', () => {
  it('flags a SECURITY DEFINER function with no REVOKE', () => {
    expect(rules(fn())).toEqual(['DEFINER_WITHOUT_REVOKE']);
  });

  it('accepts a REVOKE that names the function', () => {
    const sql =
      fn() +
      NL +
      'REVOKE ALL ON FUNCTION public.fn_risky(uuid) FROM PUBLIC, anon, authenticated;' +
      NL +
      'GRANT EXECUTE ON FUNCTION public.fn_risky(uuid) TO service_role;';
    expect(lintSql(sql)).toEqual([]);
  });

  it('accepts a dynamic REVOKE inside a DO block that names the function (migration 337 style)', () => {
    const sql =
      fn() +
      NL +
      "DO $$ DECLARE r record; BEGIN FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname IN ('fn_risky') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig); END LOOP; END $$;";
    expect(lintSql(sql)).toEqual([]);
  });

  it('a REVOKE for a DIFFERENT function does not count', () => {
    expect(rules(fn(NL + 'REVOKE ALL ON FUNCTION public.fn_other(uuid) FROM PUBLIC;'))).toEqual([
      'DEFINER_WITHOUT_REVOKE',
    ]);
  });

  it('does not flag SECURITY INVOKER functions', () => {
    expect(lintSql('CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;')).toEqual([]);
  });

  it('an annotation with a reason allows it; without a reason it does not', () => {
    expect(lintSql('-- lint:allow event trigger helper, never exposed' + NL + fn())).toEqual([]);
    expect(rules('-- lint:allow' + NL + fn())).toEqual(['DEFINER_WITHOUT_REVOKE']);
  });

  it('every pending migration of the integrated release (324-337) satisfies the rule', () => {
    const dir = path.resolve(__dirname, '../../src/database/migrations_pending');
    const mine = fs.readdirSync(dir).filter((f) => /^3(2[4-9]|3[0-9])_.*\.sql$/.test(f));
    expect(mine.length).toBeGreaterThanOrEqual(10);
    for (const f of mine) {
      const v = lintSql(fs.readFileSync(path.join(dir, f), 'utf8'), f).filter(
        (x) => x.rule === 'DEFINER_WITHOUT_REVOKE',
      );
      expect({ f, v }).toEqual({ f, v: [] });
    }
  });
});
