import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReleaseLineDto {
  @IsUUID()
  agreement_item_id: string;

  @IsNumber()
  @Min(0.0001)
  released_quantity: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateReleaseDto {
  @IsUUID()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  release_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReleaseLineDto)
  items: ReleaseLineDto[];
}
