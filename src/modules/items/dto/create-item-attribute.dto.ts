import { IsString, IsNotEmpty } from 'class-validator';

export class CreateItemAttributeDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
