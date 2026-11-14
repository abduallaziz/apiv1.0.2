import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class PublishToBranchesDto {
  @IsString()
  @IsNotEmpty()
  entity_type: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  source_ids: string[];

  /** Branch ids, or the string 'all' (every active branch except the source). */
  @ValidateIf((o: PublishToBranchesDto) => o.target_branch_ids !== 'all')
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  target_branch_ids: string[] | 'all';

  @IsIn(['copy_new', 'update_existing'])
  mode: 'copy_new' | 'update_existing';
}
