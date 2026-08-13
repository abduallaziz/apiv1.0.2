// Normalization layer (Phase 4). Prepares a raw scan value for the
// Resolver Engine (Phase 5) without attempting any entity resolution here
// — that boundary is intentional per the approved architecture (Event
// Engine normalizes, Resolver Engine resolves).
export function normalizeScanValue(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, ' ').toUpperCase();
}
