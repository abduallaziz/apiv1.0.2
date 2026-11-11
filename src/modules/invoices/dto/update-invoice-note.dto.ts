import { IsString, MaxLength } from 'class-validator';

// G6 � the note is the only thing editable on an invoice after the sale
// (non-financial). An empty string clears it.
export class UpdateInvoiceNoteDto {
  @IsString()
  @MaxLength(500)
  note: string;
}
