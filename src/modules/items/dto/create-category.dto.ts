import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export enum CategoryType {
  PRODUCT = 'product',
  SERVICE = 'service',
  EXPENSE = 'expense',
}

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(CategoryType)
  type: CategoryType;
}