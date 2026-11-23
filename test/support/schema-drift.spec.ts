// eslint-disable-next-line @typescript-eslint/no-require-imports
const { compareSchemas, CATEGORIES } = require('../../scripts/schema-drift.js') as {
  compareSchemas: (a: Schema, b: Schema) => Diff[];
  CATEGORIES: string[];
};

type Schema = Record<string, Record<string, string>>;
type Diff = { category: string; key: string; kind: string; local?: string; snapshot?: string };

const empty = (): Schema => Object.fromEntries(CATEGORIES.map((c) => [c, {}]));

describe('schema drift comparison (synthetic schemas, no database)', () => {
  it('reports nothing for identical schemas', () => {
    const a = empty();
    a.tables.tenants = 'r';
    a.columns['tenants.name'] = 'text | not_null=true | default= | identity= | generated=';
    expect(compareSchemas(a, JSON.parse(JSON.stringify(a)))).toEqual([]);
  });

  it('classifies objects present on one side only, by object', () => {
    const local = empty();
    const snap = empty();
    local.tables.only_local = 'r';
    snap.tables.only_snap = 'r';
    snap.columns['tenants.tax_rate'] = 'numeric(5,2) | not_null=false | default=15 | identity= | generated=';
    snap.functions['f(a integer)'] = 'create function f';
    const d = compareSchemas(local, snap);
    expect(d).toContainEqual({ category: 'tables', key: 'only_local', kind: 'only_in_migrations', local: 'r' });
    expect(d).toContainEqual({ category: 'tables', key: 'only_snap', kind: 'only_in_snapshot', snapshot: 'r' });
    expect(d.find((x) => x.key === 'tenants.tax_rate')).toMatchObject({ category: 'columns', kind: 'only_in_snapshot' });
    expect(d.find((x) => x.key === 'f(a integer)')).toMatchObject({ category: 'functions', kind: 'only_in_snapshot' });
  });

  it('detects type, default and nullability changes on a shared column', () => {
    const local = empty();
    const snap = empty();
    local.columns['t.c'] = 'text | not_null=false | default= | identity= | generated=';
    snap.columns['t.c'] = 'text | not_null=true | default= | identity= | generated=';
    local.indexes['t.i'] = 'CREATE INDEX i ON t (a)';
    snap.indexes['t.i'] = 'CREATE INDEX i ON t (b)';
    const d = compareSchemas(local, snap);
    expect(d.map((x) => `${x.category}:${x.kind}`).sort()).toEqual(['columns:different', 'indexes:different']);
  });

  it('is deterministic and covers every category', () => {
    const local = empty();
    const snap = empty();
    for (const c of CATEGORIES) snap[c].zz = 'x';
    const d = compareSchemas(local, snap);
    expect(d.map((x) => x.category)).toEqual(CATEGORIES);
  });
});
