import { IsUUID, IsOptional, IsObject } from 'class-validator';

// Inventory #7 / 7-5 (Owner-approved) — criteria is a free-form JSONB
// object by design (the extensible eligibility model); validated for
// shape (individual key types) at evaluation time inside the RPC, not
// here, since the supported key set grows without a schema/DTO change.
export class CreateWaveDto {
  @IsUUID()
  warehouse_id: string;

  @IsObject()
  @IsOptional()
  criteria?: Record<string, unknown>;
}
