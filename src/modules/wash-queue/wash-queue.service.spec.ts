import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WashQueueService } from './wash-queue.service';
import { WashJob } from './wash-queue.repository';
import {
  canRewash,
  canTransition,
  WASH_STATUSES,
  WashStatus,
} from './wash-queue.state-machine';

const tenant = { tenantId: 't1' } as never;
const mgr = { id: 'u1', role: 'manager' };
const cashier = { id: 'u2', role: 'cashier' };

const job = (status: WashJob['status']): WashJob =>
  ({
    id: 'j1',
    tenant_id: 't1',
    branch_id: 'b1',
    order_id: null,
    customer_id: null,
    plate: 'ABC 1',
    status,
    assigned_worker_id: null,
    queue_number: 3,
  }) as WashJob;

describe('wash queue state machine', () => {
  const allowed: Record<string, string[]> = {
    waiting: ['washing', 'cancelled'],
    washing: ['ready', 'cancelled'],
    ready: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  it('allows exactly the agreed forward transitions', () => {
    for (const from of WASH_STATUSES) {
      for (const to of WASH_STATUSES) {
        expect(canTransition(from, to)).toBe(allowed[from].includes(to));
      }
    }
  });

  it('allows ready -> washing only for the re-wash flag', () => {
    expect(canTransition('ready', 'washing')).toBe(false);
    expect(canTransition('ready', 'washing', true)).toBe(true);
    // the flag opens nothing else
    expect(canTransition('delivered', 'washing', true)).toBe(false);
    expect(canTransition('cancelled', 'washing', true)).toBe(false);
    expect(canTransition('washing', 'waiting' as WashStatus, true)).toBe(false);
  });

  it('re-wash roles', () => {
    expect(canRewash('owner')).toBe(true);
    expect(canRewash('manager')).toBe(true);
    expect(canRewash('cashier')).toBe(false);
    expect(canRewash(undefined)).toBe(false);
  });
});

describe('WashQueueService', () => {
  let repo: Record<string, jest.Mock>;
  let audit: { log: jest.Mock };
  let notifier: { notify: jest.Mock };
  let svc: WashQueueService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      transition: jest.fn(),
      assign: jest.fn(),
      markNotified: jest.fn().mockResolvedValue(undefined),
      listBoard: jest.fn(),
      findOne: jest.fn(),
      listEvents: jest.fn().mockResolvedValue([]),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notifier = { notify: jest.fn().mockResolvedValue(true) };
    svc = new WashQueueService(repo as never, audit as never, notifier);
  });

  it('groups the board by status', async () => {
    repo.listBoard.mockResolvedValue([
      job('waiting'),
      job('washing'),
      job('ready'),
      job('waiting'),
    ]);
    const b = await svc.board(tenant, 'b1', '2026-11-09');
    expect(b.columns.waiting).toHaveLength(2);
    expect(b.columns.washing).toHaveLength(1);
    expect(b.columns.ready).toHaveLength(1);
    expect(b.columns.delivered).toHaveLength(0);
  });

  it('rejects an invalid transition before touching the database', async () => {
    repo.findOne.mockResolvedValue(job('waiting'));
    await expect(
      svc.changeStatus(tenant, 'j1', { status: 'ready' }, mgr),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('forbids re-wash for a non-authorised role', async () => {
    repo.findOne.mockResolvedValue(job('ready'));
    await expect(
      svc.changeStatus(tenant, 'j1', { status: 'washing' }, cashier),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('passes the re-wash flag for a manager', async () => {
    repo.findOne.mockResolvedValue(job('ready'));
    repo.transition.mockResolvedValue(job('washing'));
    await svc.changeStatus(tenant, 'j1', { status: 'washing' }, mgr);
    expect(repo.transition).toHaveBeenCalledWith('t1', 'j1', 'washing', 'u1', true);
  });

  it('notifies and stamps ready_notified_at when a job becomes ready', async () => {
    repo.findOne.mockResolvedValue(job('washing'));
    repo.transition.mockResolvedValue(job('ready'));
    const out = await svc.changeStatus(tenant, 'j1', { status: 'ready' }, cashier);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1', plate: 'ABC 1', queueNumber: 3 }),
    );
    expect(repo.markNotified).toHaveBeenCalledWith('t1', 'j1');
    expect(out.ready_notified_at).not.toBeNull();
  });

  it('does not notify for other statuses', async () => {
    repo.findOne.mockResolvedValue(job('waiting'));
    repo.transition.mockResolvedValue(job('washing'));
    await svc.changeStatus(tenant, 'j1', { status: 'washing' }, cashier);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('a throwing notifier never blocks the status change', async () => {
    repo.findOne.mockResolvedValue(job('washing'));
    repo.transition.mockResolvedValue(job('ready'));
    notifier.notify.mockRejectedValue(new Error('boom'));
    const out = await svc.changeStatus(tenant, 'j1', { status: 'ready' }, cashier);
    expect(out.status).toBe('ready');
    expect(repo.markNotified).not.toHaveBeenCalled();
  });

  it('a notifier that did not deliver leaves ready_notified_at empty', async () => {
    repo.findOne.mockResolvedValue(job('washing'));
    repo.transition.mockResolvedValue(job('ready'));
    notifier.notify.mockResolvedValue(false);
    await svc.changeStatus(tenant, 'j1', { status: 'ready' }, cashier);
    expect(repo.markNotified).not.toHaveBeenCalled();
  });

  it('maps database rule errors to HTTP errors', async () => {
    repo.create.mockRejectedValue({
      code: 'P0001',
      message: 'WASH_BRANCH_NOT_FOUND: branch not found',
    });
    await expect(
      svc.create(tenant, { branch_id: 'b', plate: 'X' }, mgr),
    ).rejects.toBeInstanceOf(BadRequestException);

    repo.assign.mockRejectedValue({
      code: 'P0001',
      message: 'WASH_JOB_NOT_FOUND: wash job not found',
    });
    await expect(svc.assign(tenant, 'j', null, mgr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getOne returns the job with its history', async () => {
    repo.findOne.mockResolvedValue(job('waiting'));
    repo.listEvents.mockResolvedValue([{ event_type: 'created' }]);
    const r = await svc.getOne(tenant, 'j1');
    expect(r.events).toHaveLength(1);
    repo.findOne.mockResolvedValue(null);
    await expect(svc.getOne(tenant, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
