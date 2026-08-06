// No fields — non_conformances (migration 145) has no resolution-notes
// column, only resolved_by/resolved_at (set server-side). Kept as an empty
// DTO class (rather than no body at all) for consistency with every other
// action route in this module accepting a typed @Body().
export class CloseNonConformanceDto {}
