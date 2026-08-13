import { ItemBarcodeResolver } from '../item-barcode.resolver';
import { LocationResolver } from '../location.resolver';
import { BatchResolver } from '../batch.resolver';
import { SerialResolver } from '../serial.resolver';
import { RfidResolver } from '../rfid.resolver';
import { normalizeScanValue } from '../../utils/normalize-scan-value.util';

const CONTEXT = { tenantId: 'tenant-1' };

describe('ItemBarcodeResolver', () => {
  it('returns no_match when the repository finds nothing', async () => {
    const repo = { lookupByBarcode: jest.fn().mockResolvedValue(null) };
    const resolver = new ItemBarcodeResolver(repo as any);
    const outcome = await resolver.resolve('123', CONTEXT);
    expect(outcome).toEqual({ status: 'no_match' });
  });

  it('resolves to entity_type=item when the barcode has no variant', async () => {
    const repo = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        barcode: '123',
        barcode_type: 'EAN',
        item_id: 'item-1',
        variant_id: null,
        items: { id: 'item-1', name: 'Widget', is_active: true },
        item_variants: null,
      }),
    };
    const resolver = new ItemBarcodeResolver(repo as any);
    const outcome = await resolver.resolve('123', CONTEXT);
    expect(outcome).toMatchObject({
      status: 'match',
      entityType: 'item',
      entityId: 'item-1',
    });
  });

  it('resolves to entity_type=variant when the barcode has a variant', async () => {
    const repo = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        barcode: '123',
        barcode_type: 'EAN',
        item_id: 'item-1',
        variant_id: 'variant-1',
        items: { id: 'item-1', name: 'Widget', is_active: true },
        item_variants: { id: 'variant-1', name: 'Red', is_active: true },
      }),
    };
    const resolver = new ItemBarcodeResolver(repo as any);
    const outcome = await resolver.resolve('123', CONTEXT);
    expect(outcome).toMatchObject({
      status: 'match',
      entityType: 'variant',
      entityId: 'variant-1',
    });
  });

  it('flags an inactive item in metadata rather than rejecting the match', async () => {
    const repo = {
      lookupByBarcode: jest.fn().mockResolvedValue({
        barcode: '123',
        barcode_type: 'EAN',
        item_id: 'item-1',
        variant_id: null,
        items: { id: 'item-1', name: 'Widget', is_active: false },
        item_variants: null,
      }),
    };
    const resolver = new ItemBarcodeResolver(repo as any);
    const outcome: any = await resolver.resolve('123', CONTEXT);
    expect(outcome.status).toBe('match');
    expect(outcome.metadata.is_active).toBe(false);
  });
});

describe('LocationResolver', () => {
  it('returns no_match for an empty result', async () => {
    const repo = { findByCode: jest.fn().mockResolvedValue([]) };
    const resolver = new LocationResolver(repo as any);
    expect(await resolver.resolve('A-01', CONTEXT)).toEqual({
      status: 'no_match',
    });
  });

  it('returns ambiguous when the code exists in more than one warehouse and no hint disambiguates', async () => {
    const repo = {
      findByCode: jest.fn().mockResolvedValue([
        {
          id: 'loc-1',
          warehouse_id: 'wh-1',
          code: 'A-01',
          name: 'A',
          zone: null,
          is_active: true,
          warehouses: { id: 'wh-1', name: 'WH1' },
        },
        {
          id: 'loc-2',
          warehouse_id: 'wh-2',
          code: 'A-01',
          name: 'A',
          zone: null,
          is_active: true,
          warehouses: { id: 'wh-2', name: 'WH2' },
        },
      ]),
    };
    const resolver = new LocationResolver(repo as any);
    const outcome = await resolver.resolve('A-01', CONTEXT);
    expect(outcome.status).toBe('ambiguous');
  });

  it('resolves unambiguously when a warehouse hint narrows a multi-match down to one', async () => {
    const repo = {
      findByCode: jest.fn().mockResolvedValue([
        {
          id: 'loc-1',
          warehouse_id: 'wh-1',
          code: 'A-01',
          name: 'A',
          zone: null,
          is_active: true,
          warehouses: { id: 'wh-1', name: 'WH1' },
        },
        {
          id: 'loc-2',
          warehouse_id: 'wh-2',
          code: 'A-01',
          name: 'A',
          zone: null,
          is_active: true,
          warehouses: { id: 'wh-2', name: 'WH2' },
        },
      ]),
    };
    const resolver = new LocationResolver(repo as any);
    const outcome = await resolver.resolve('A-01', {
      ...CONTEXT,
      warehouseId: 'wh-2',
    });
    expect(outcome).toMatchObject({ status: 'match', entityId: 'loc-2' });
  });
});

describe('BatchResolver', () => {
  it('returns ambiguous when more than one item shares a batch_number', async () => {
    const repo = {
      findByBatchNumber: jest
        .fn()
        .mockResolvedValue([{ id: 'batch-1' }, { id: 'batch-2' }]),
    };
    const resolver = new BatchResolver(repo as any);
    const outcome = await resolver.resolve('LOT-1', CONTEXT);
    expect(outcome.status).toBe('ambiguous');
  });

  it('resolves a unique batch_number to entity_type=batch', async () => {
    const repo = {
      findByBatchNumber: jest.fn().mockResolvedValue([
        {
          id: 'batch-1',
          item_id: 'item-1',
          variant_id: null,
          batch_number: 'LOT-1',
          expiration_date: null,
          items: { id: 'item-1', name: 'Widget', is_active: true },
          item_variants: null,
        },
      ]),
    };
    const resolver = new BatchResolver(repo as any);
    const outcome = await resolver.resolve('LOT-1', CONTEXT);
    expect(outcome).toMatchObject({
      status: 'match',
      entityType: 'batch',
      entityId: 'batch-1',
    });
  });
});

describe('SerialResolver', () => {
  it('flags a scrapped serial as inactive rather than rejecting the match', async () => {
    const repo = {
      findByNumber: jest.fn().mockResolvedValue([
        {
          id: 'serial-1',
          item_id: 'item-1',
          variant_id: null,
          serial_number: 'SN-1',
          status: 'scrapped',
          items: null,
          item_variants: null,
        },
      ]),
    };
    const resolver = new SerialResolver(repo as any);
    const outcome: any = await resolver.resolve('SN-1', CONTEXT);
    expect(outcome.status).toBe('match');
    expect(outcome.metadata.is_active).toBe(false);
  });

  it('returns ambiguous when a serial number is shared across items', async () => {
    const repo = {
      findByNumber: jest
        .fn()
        .mockResolvedValue([{ id: 'serial-1' }, { id: 'serial-2' }]),
    };
    const resolver = new SerialResolver(repo as any);
    const outcome = await resolver.resolve('SN-1', CONTEXT);
    expect(outcome.status).toBe('ambiguous');
  });
});

describe('RfidResolver', () => {
  it('returns no_match when no tag matches', async () => {
    const repo = { findByTagValue: jest.fn().mockResolvedValue([]) };
    const resolver = new RfidResolver(repo as any);
    expect(await resolver.resolve('E200-1234', CONTEXT)).toEqual({
      status: 'no_match',
    });
  });

  it('resolves a matching tag to entity_type=rfid', async () => {
    const repo = {
      findByTagValue: jest.fn().mockResolvedValue([
        {
          id: 'tag-1',
          item_id: 'item-1',
          variant_id: null,
          tag_value: 'E200-1234',
          items: { name: 'Widget', is_active: true },
          item_variants: null,
        },
      ]),
    };
    const resolver = new RfidResolver(repo as any);
    const outcome = await resolver.resolve('E200-1234', CONTEXT);
    expect(outcome).toMatchObject({
      status: 'match',
      entityType: 'rfid',
      entityId: 'tag-1',
    });
  });
});

describe('normalization compatibility with resolvers', () => {
  it('normalizes a raw value the same way before every resolver sees it', () => {
    expect(normalizeScanValue('  a-01  ')).toBe('A-01');
    expect(normalizeScanValue('lot-1')).toBe('LOT-1');
  });
});
