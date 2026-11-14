import { BadRequestException } from '@nestjs/common';
import { ExpenseAttachmentsService } from './expense-attachments.service';

describe('ExpenseAttachmentsService.upload', () => {
  it('rejects unsupported file types before touching storage', async () => {
    const storage = { upload: jest.fn() };
    const service = new ExpenseAttachmentsService(
      {} as never,
      storage as never,
    );
    const file = {
      mimetype: 'text/plain',
      originalname: 'a.txt',
      buffer: Buffer.from('x'),
    };
    await expect(
      service.upload('t', 'e', 'u', file as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
