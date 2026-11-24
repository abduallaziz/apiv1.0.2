// Preload for local scripts: the local docker stack exposes bare PostgREST (no Kong), so drop the
// '/rest/v1' prefix supabase-js adds (same as test/support/integration-setup.ts does for specs).
const baseFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  baseFetch(typeof input === 'string' ? input.replace('/rest/v1/', '/') : input, init);
