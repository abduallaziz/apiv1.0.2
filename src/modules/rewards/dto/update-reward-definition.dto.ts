import { PartialType } from '@nestjs/mapped-types';
import { CreateRewardDefinitionDto } from './create-reward-definition.dto';

export class UpdateRewardDefinitionDto extends PartialType(
  CreateRewardDefinitionDto,
) {}
