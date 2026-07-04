import { IsNumber, IsString, MinLength } from 'class-validator';

export class AttendanceCheckDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsString()
  @MinLength(8)
  device_fingerprint: string;
}
