import { IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CloseShiftDto {
  // Legacy single counted-cash figure. Still accepted; when `counts` is
  // sent, counts.cash wins.
  @IsNumber()
  @Min(0)
  @IsOptional()
  closing_cash?: number;

  // Phase 2 (blind count): what the cashier physically counted per payment
  // method, e.g. { cash: 60, mada: 11.5, visa: 0, mastercard: 0 }. Keys and
  // values are validated in ShiftsService.closeShift.
  @IsObject()
  @IsOptional()
  counts?: Record<string, number>;

  @IsString()
  @IsOptional()
  notes?: string;
}
