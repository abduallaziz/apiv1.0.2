export class PaginationDto {
  page: number;
  perPage: number;

  constructor(page?: string | number, perPage?: string | number) {
    this.page = Math.max(1, Number(page) || 1);
    this.perPage = Math.min(100, Math.max(1, Number(perPage) || 50));
  }

  get offset(): number {
    return (this.page - 1) * this.perPage;
  }

  /** Supabase range: [from, to] inclusive */
  get range(): [number, number] {
    return [this.offset, this.offset + this.perPage - 1];
  }
}
