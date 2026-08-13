import {
  IsString,
  IsOptional,
  IsUUID,
  IsIn,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateWarehouseTaskDto {
  @IsUUID()
  warehouse_id: string;

  @IsIn(['putaway', 'replenishment'])
  task_type: 'putaway' | 'replenishment';

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsUUID()
  @IsOptional()
  source_location_id?: string;

  @IsUUID()
  @IsOptional()
  suggested_location_id?: string;

  @IsIn(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  source_document_type?: string;

  @IsUUID()
  @IsOptional()
  source_document_id?: string;
}
