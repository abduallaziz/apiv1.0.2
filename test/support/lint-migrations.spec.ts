// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lintSql } = require('../../scripts/lint-migrations.js') as {
  lintSql: (sql: string, file?: string) => { rule: string; line: number; message: string }[];
};

const rules = (sql: string) => lintSql(sql).map((v) => v.rule);

describe('migration lint', () => {
  it('accepts a clean idempotent migration', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS t (id int primary key);
      ALTER TABLE t ADD COLUMN IF NOT EXISTS name text;
      CREATE INDEX IF NOT EXISTS idx_t_name ON t (name);
      CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
      DROP TRIGGER IF EXISTS trg ON t;
      CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();
      DROP POLICY IF EXISTS p ON t;
      CREATE POLICY p ON t USING (true);
      ALTER TABLE t DROP CONSTRAINT IF EXISTS c1;
      ALTER TABLE t ADD CONSTRAINT c1 CHECK (id > 0);
      UPDATE t SET name = 'x' WHERE id = 1;
      DELETE FROM t WHERE id = 2;
    `;
    expect(lintSql(sql)).toEqual([]);
  });

  it.each([
    ['DROP TABLE t;', 'DROP_TABLE'],
    ['drop table if exists t cascade;', 'DROP_TABLE'],
    ['ALTER TABLE t DROP COLUMN c;', 'DROP_COLUMN'],
    ['ALTER TABLE t\n  DROP COLUMN IF EXISTS c;', 'DROP_COLUMN'],
    ['TRUNCATE t;', 'TRUNCATE'],
    ['DELETE FROM t;', 'DELETE_NO_WHERE'],
    ['UPDATE t SET a = 1;', 'UPDATE_NO_WHERE'],
    ['CREATE TABLE t (a int);', 'NON_IDEMPOTENT_CREATE'],
    ['CREATE INDEX i ON t (a);', 'NON_IDEMPOTENT_CREATE'],
    ['CREATE UNIQUE INDEX i ON t (a);', 'NON_IDEMPOTENT_CREATE'],
    ['ALTER TABLE t ADD COLUMN a int;', 'NON_IDEMPOTENT_CREATE'],
    ['CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();', 'NON_IDEMPOTENT_CREATE'],
    ['CREATE POLICY p ON t USING (true);', 'NON_IDEMPOTENT_CREATE'],
    ['ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0);', 'NON_IDEMPOTENT_CREATE'],
    ["CREATE TYPE e AS ENUM ('a');", 'NON_IDEMPOTENT_CREATE'],
  ])('blocks %s', (sql, rule) => {
    expect(rules(sql)).toContain(rule);
  });

  it('allows an annotated statement, but only with a reason', () => {
    expect(lintSql('-- lint:allow retired table, owner approved 2026-12-01\nDROP TABLE old_t;')).toEqual([]);
    expect(lintSql('DROP TABLE old_t; -- not annotated')).toHaveLength(1);
    const noReason = lintSql('-- lint:allow\nDROP TABLE old_t;');
    expect(noReason).toHaveLength(1);
    expect(noReason[0].message).toMatch(/needs a reason/);
  });

  it('annotation applies to its own statement only', () => {
    const sql = '-- lint:allow reason here\nDROP TABLE a;\nDROP TABLE b;';
    const v = lintSql(sql);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
  });

  it('ignores keywords in comments, strings and function bodies', () => {
    const sql = `
      -- DROP TABLE x; TRUNCATE y;
      /* DELETE FROM z; */
      COMMENT ON TABLE t IS 'we never DROP TABLE or TRUNCATE here';
      CREATE OR REPLACE FUNCTION g() RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN DELETE FROM t; UPDATE t SET a = 1; END $fn$;
    `;
    expect(lintSql(sql)).toEqual([]);
  });

  it('inspects DO blocks for destructive statements but not for guarded creates', () => {
    const bad = "DO $$ BEGIN DELETE FROM t; TRUNCATE u; END $$;";
    expect(rules(bad).sort()).toEqual(['DELETE_NO_WHERE', 'TRUNCATE'].sort());
    const guarded = 'DO $$ BEGIN CREATE TYPE e AS ENUM (\'a\'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;';
    expect(lintSql(guarded)).toEqual([]);
  });

  it('DELETE/UPDATE with WHERE inside DO blocks are fine', () => {
    expect(lintSql("DO $$ BEGIN UPDATE t SET a = 1 WHERE b = 2; END $$;")).toEqual([]);
  });

  it('reports a 1-based line number', () => {
    const v = lintSql('SELECT 1;\n\nTRUNCATE t;');
    expect(v[0]).toMatchObject({ rule: 'TRUNCATE', line: 3 });
  });
});
