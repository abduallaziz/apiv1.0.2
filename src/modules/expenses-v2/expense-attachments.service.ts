import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { StorageService } from '../../shared/storage/storage.service';

const SELECT =
  'id, expense_id, file_url, storage_path, file_type, uploaded_by, uploaded_at';

interface AttachmentRow {
  id: string;
  expense_id: string;
  file_url: string;
  storage_path: string;
  file_type: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

// Attachments (Step 9 — Backend API completion). First real consumer of
// the Step 1 Storage abstraction — private-by-default, tenant/owner-scoped
// paths (`{tenantId}/expense/{expenseId}/...`), signed-URL retrieval only.
@Injectable()
export class ExpenseAttachmentsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly storage: StorageService,
  ) {}

  private async assertExpenseExists(tenantId: string, expenseId: string) {
    const { data, error } = await this.supabase
      .from('expenses_v2')
      .select('id')
      .eq('id', expenseId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Expense not found');
  }

  async upload(
    tenantId: string,
    expenseId: string,
    uploadedBy: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    await this.assertExpenseExists(tenantId, expenseId);

    const uploadResult = await this.storage.upload({
      tenantId,
      ownerType: 'expense',
      ownerId: expenseId,
      uploadedBy,
      fileBuffer: file.buffer,
      fileName: file.originalname,
      fileType: file.mimetype,
    });

    const { data, error } = await this.supabase
      .from('expense_attachments')
      .insert({
        tenant_id: tenantId,
        expense_id: expenseId,
        file_url: uploadResult.fileUrl,
        storage_path: uploadResult.storagePath,
        file_type: uploadResult.fileType,
        uploaded_by: uploadedBy,
      })
      .select(SELECT)
      .single();

    if (error) throw error;
    return data;
  }

  // Re-signs each attachment's retrieval URL at read time rather than
  // trusting the URL stored at upload time, since signed URLs expire
  // (default 1h) and a listing could be viewed long after upload.
  async findByExpense(tenantId: string, expenseId: string) {
    await this.assertExpenseExists(tenantId, expenseId);

    const { data, error } = await this.supabase
      .from('expense_attachments')
      .select(SELECT)
      .eq('expense_id', expenseId)
      .eq('tenant_id', tenantId)
      .order('uploaded_at', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as AttachmentRow[];
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        file_url: await this.storage.getSignedUrl(row.storage_path),
      })),
    );
  }
}
