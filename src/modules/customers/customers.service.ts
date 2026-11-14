import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { TenantsService } from '../tenants/tenants.service';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import {
  checkContactValues,
  normalizePhone,
  normalizePlate,
} from './customer-normalize';
import {
  CreateVehicleDto,
  UpdateVehicleDto,
  CustomerCaptureDto,
} from './dto/customer-lookup.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly fieldDefinitionsRepo: CustomerFieldDefinitionsRepository,
    private readonly tenantsService: TenantsService,
  ) {}

  private async validateCustomFields(
    tenant: TenantContext,
    customFields: Record<string, unknown> | undefined,
    isCreate: boolean,
  ) {
    const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);
    const byKey = new Map(definitions.map((d) => [d.field_key, d]));

    for (const key of Object.keys(customFields ?? {})) {
      if (!byKey.has(key)) {
        throw new BadRequestException(`Unknown custom field: ${key}`);
      }
    }

    for (const def of definitions) {
      const value = customFields?.[def.field_key];

      if (
        isCreate &&
        def.required &&
        (value === undefined || value === null || value === '')
      ) {
        throw new BadRequestException(
          `Custom field "${def.field_key}" is required`,
        );
      }

      if (value === undefined || value === null) continue;

      if (def.field_type === 'number' && typeof value !== 'number') {
        throw new BadRequestException(
          `Custom field "${def.field_key}" must be a number`,
        );
      }
      if (def.field_type === 'boolean' && typeof value !== 'boolean') {
        throw new BadRequestException(
          `Custom field "${def.field_key}" must be a boolean`,
        );
      }
      if (def.field_type === 'select') {
        const allowed = (def.options ?? []).map((o) => o.value);
        if (!allowed.includes(value as string)) {
          throw new BadRequestException(
            `Custom field "${def.field_key}" has an invalid option`,
          );
        }
      }
    }
  }

  private async syncContactColumns(
    tenant: TenantContext,
    dto: {
      phone?: string;
      email?: string;
      custom_fields?: Record<string, string | number | boolean | null>;
    },
  ) {
    const customFields = dto.custom_fields ?? {};
    const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);

    const fieldForRole = (role: string) =>
      definitions.find((d) => d.contact_role === role);

    const toStringValue = (value: unknown) =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;

    const toIntValue = (value: unknown) => {
      if (typeof value === 'number') return Math.trunc(value);
      if (
        typeof value === 'string' &&
        value.trim() !== '' &&
        !isNaN(Number(value))
      )
        return Math.trunc(Number(value));
      return undefined;
    };

    const phoneField = fieldForRole('phone');
    const emailField = fieldForRole('email');
    const plateField = fieldForRole('plate_number');
    const visitDateField = fieldForRole('visit_date');
    const odometerField = fieldForRole('odometer');

    const phone =
      dto.phone ??
      toStringValue(
        phoneField ? customFields[phoneField.field_key] : undefined,
      );
    const email =
      dto.email ??
      toStringValue(
        emailField ? customFields[emailField.field_key] : undefined,
      );
    const plate_number = toStringValue(
      plateField ? customFields[plateField.field_key] : undefined,
    );
    const visit_date = toStringValue(
      visitDateField ? customFields[visitDateField.field_key] : undefined,
    );
    const odometer = toIntValue(
      odometerField ? customFields[odometerField.field_key] : undefined,
    );

    const checked = checkContactValues({ phone, plate: plate_number });
    if (checked.error) throw new BadRequestException(checked.error);

    return {
      phone: checked.phone,
      email,
      plate_number: plate_number?.trim() || undefined,
      visit_date,
      odometer,
    };
  }

  async getStats(tenant: TenantContext, from?: string, to?: string) {
    return this.repo.getGlobalStats(
      tenant,
      from && to ? { from, to } : undefined,
    );
  }

  // Customer Domain Phase 4 (Owner-approved) — SHARED: no visibility
  // restriction at all (customer_identity_scope='shared', or the actor is
  // Central). BRANCH + restricted actor: visibility limited to customers
  // with an established relationship to the actor's own branch. Returns
  // null when unrestricted (SHARED, or Central under BRANCH) — matches the
  // "null = tenant-wide" convention already used throughout this codebase
  // (users.branch_id, BranchAuthorizationService's effectiveBranchId).
  // Deliberately does NOT call BranchAuthorizationService.resolveBranchScope
  // here: that method also validates/allows an explicit requested branch_id
  // for reassignment-style requests, which Customer Scope has no equivalent
  // of — visibility is purely derived from the actor's own branch, not a
  // client-supplied parameter, so a smaller purpose-built check is used
  // instead of stretching the shared service to a shape it wasn't designed
  // for.
  private async resolveVisibilityBranchId(
    tenant: TenantContext,
    user: JwtPayload,
  ): Promise<string | null> {
    if (!tenant.tenantId) return null; // superadmin cross-tenant caller
    if (user.branch_id === null || user.branch_id === undefined) return null; // Central
    const scope = await this.repo.getCustomerIdentityScope(tenant.tenantId);
    if (scope === 'shared') return null;
    return user.branch_id;
  }

  async findAll(
    tenant: TenantContext,
    user: JwtPayload,
    query: CustomerQueryDto,
  ) {
    let customFieldKeys: string[] = [];
    if (query.search) {
      const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);
      // custom_fields->>key always returns text regardless of the underlying JSON type,
      // so every field type (including number) is searchable via ilike.
      customFieldKeys = definitions.map((d) => d.field_key);
    }

    const visibilityBranchId = await this.resolveVisibilityBranchId(
      tenant,
      user,
    );
    let restrictToCustomerIds: string[] | undefined;
    if (visibilityBranchId) {
      restrictToCustomerIds = await this.repo.findRelatedCustomerIds(
        tenant.tenantId,
        visibilityBranchId,
      );
      if (restrictToCustomerIds.length === 0) return { data: [], total: 0 };
    }

    return this.repo.findAll(
      tenant,
      query.search,
      query.page,
      query.limit,
      customFieldKeys,
      restrictToCustomerIds,
      query.sortBy,
      query.sortOrder,
    );
  }

  // Tenant-scoped existence check only, deliberately WITHOUT any Customer
  // Scope visibility restriction. Used by checkout/order-attachment
  // (invoices.service.ts) — Customer Scope governs list/search discovery,
  // it must never block a transaction with a customer the cashier already
  // has an id for (approved decision: "Customer Scope MUST NOT prevent a
  // customer from buying at another branch").
  async findByIdUnrestricted(tenant: TenantContext, id: string) {
    const customer = await this.repo.findById(tenant, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async findById(tenant: TenantContext, user: JwtPayload, id: string) {
    const customer = await this.findByIdUnrestricted(tenant, id);

    const visibilityBranchId = await this.resolveVisibilityBranchId(
      tenant,
      user,
    );
    if (visibilityBranchId) {
      const related = await this.repo.hasRelationship(
        tenant.tenantId,
        id,
        visibilityBranchId,
      );
      // Same convention as BranchAuthorizationService's own documented
      // rule for detail-by-id reads: 404, not 403, so an unrelated
      // restricted actor cannot use this endpoint to confirm a customer
      // exists in another branch.
      if (!related) throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async create(
    tenant: TenantContext,
    user: JwtPayload,
    dto: CreateCustomerDto,
    opts: { allowEmpty?: boolean } = {},
  ) {
    const { phone, email, plate_number, visit_date, odometer } =
      await this.syncContactColumns(tenant, dto);

    if (
      !opts.allowEmpty &&
      !phone &&
      !plate_number &&
      !dto.full_name?.trim() &&
      !email
    ) {
      throw new BadRequestException(
        'A phone number or a plate number is required',
      );
    }

    if (phone) {
      const existing = await this.repo.findByPhone(tenant, phone);
      if (existing)
        throw new BadRequestException(
          'Phone already registered for this tenant',
        );
    }
    // T12 — a plate can never exist under two customers: reject BEFORE the
    // customer row is written.
    const plateN = normalizePlate(plate_number);
    if (plateN && (await this.repo.findVehicleByPlate(tenant, plateN))) {
      throw new ConflictException({
        message: 'This plate is already registered to another customer',
        reasonCode: 'plate_already_registered',
      });
    }
    await this.validateCustomFields(tenant, dto.custom_fields, true);

    const posConfig = await this.tenantsService.getPosConfig(tenant.tenantId);

    let full_name = dto.full_name;
    if (posConfig.name_field_enabled) {
      if (!full_name?.trim()) {
        throw new BadRequestException('full_name is required');
      }
    } else {
      const count = await this.repo.countAll(tenant);
      full_name = `عميل ${count + 1}`;
    }

    // Customer Domain Phase 2 (Owner-approved) — created_branch_id is
    // informational provenance only, never an authorization/visibility
    // scope (that's Phase 3/4's job). A restricted (branch-scoped) actor's
    // own branch is always captured automatically, per the approved
    // decision ("a cashier-created customer automatically receives the
    // cashier's current branch context") — it cannot be overridden by the
    // request body. A Central actor (user.branch_id === null) may
    // explicitly select a branch via dto.created_branch_id, or omit it
    // entirely — NULL is a valid, non-error state.
    const created_branch_id = user.branch_id ?? dto.created_branch_id ?? null;

    const customer = await this.repo.create(tenant, {
      ...dto,
      full_name,
      phone,
      email,
      plate_number,
      visit_date,
      odometer,
      created_branch_id,
    });

    // T12 — the plate typed on the customer form becomes the first car.
    if (plateN && plate_number) {
      await this.insertVehicle(tenant, customer.id, { plate: plate_number });
    }

    // Phase 3: creation with a known branch context seeds the first
    // relationship row (source='created') — best-effort, never blocks
    // customer creation itself on a relationship-write failure.
    if (created_branch_id) {
      await this.repo
        .upsertRelationship(tenant, customer.id, created_branch_id, 'created')
        .catch(() => {});
    }

    return customer;
  }

  async update(
    tenant: TenantContext,
    user: JwtPayload,
    id: string,
    dto: UpdateCustomerDto,
  ) {
    await this.findById(tenant, user, id);

    const { phone, email, plate_number, visit_date, odometer } =
      await this.syncContactColumns(tenant, dto);

    if (phone) {
      const existing = await this.repo.findByPhone(tenant, phone);
      if (existing && existing.id !== id) {
        throw new BadRequestException(
          'Phone already registered for this tenant',
        );
      }
    }

    if (dto.custom_fields) {
      await this.validateCustomFields(tenant, dto.custom_fields, false);
    }

    return this.repo.update(tenant, id, {
      ...dto,
      phone,
      email,
      plate_number,
      visit_date,
      odometer,
    });
  }

  async remove(tenant: TenantContext, user: JwtPayload, id: string) {
    await this.findById(tenant, user, id);
    await this.repo.softDelete(tenant, id);
    return { message: 'Customer deleted' };
  }

  // Customer Domain Phase 3 (Owner-approved) — called from order/invoice
  // creation when a customer is attached to a transaction. Best-effort,
  // never blocks the sale on a relationship-write failure.
  async recordBranchActivity(
    tenant: TenantContext,
    customerId: string,
    branchId: string,
  ) {
    await this.repo
      .upsertRelationship(tenant, customerId, branchId, 'transaction')
      .catch(() => {});
  }

  // ------------------------------------------------------------------
  // T12 — customer auto-recognition. Owner rules: one customer = ONE phone
  // and any number of cars; a plate belongs to exactly one customer; no
  // duplicates, no merge. Deliberately NOT restricted by Customer Scope
  // (a plate/phone must be recognised at every branch, otherwise creating
  // it again would hit the unique index).
  // ------------------------------------------------------------------
  // The names let the client show "use the registered customer" without a
  // second request. No merge, no second customer, ever.
  private async conflict(
    tenant: TenantContext,
    plate: string | null,
    phone: string | null,
    phoneCustomerId: string,
    plateCustomerId: string,
  ): Promise<never> {
    const [phoneCustomer, plateCustomer] = await Promise.all([
      this.repo.findById(tenant, phoneCustomerId),
      this.repo.findById(tenant, plateCustomerId),
    ]);
    throw new ConflictException({
      message:
        'This plate is registered to a different customer than this phone number',
      reasonCode: 'customer_capture_conflict',
      plate,
      phone,
      phone_customer: phoneCustomer
        ? { id: phoneCustomer.id, full_name: phoneCustomer.full_name }
        : null,
      plate_customer: plateCustomer
        ? { id: plateCustomer.id, full_name: plateCustomer.full_name }
        : null,
    });
  }

  async lookup(
    tenant: TenantContext,
    query: { plate?: string; phone?: string },
  ) {
    const plateN = normalizePlate(query.plate);
    const phoneN = normalizePhone(query.phone);
    if (!plateN && !phoneN) {
      throw new BadRequestException('plate or phone is required');
    }

    const byPhone = phoneN
      ? await this.repo.findByPhoneNormalized(tenant, phoneN)
      : null;
    const byPlate = plateN
      ? await this.repo.findVehicleByPlate(tenant, plateN)
      : null;

    if (byPhone && byPlate && byPlate.customer_id !== byPhone.id) {
      await this.conflict(
        tenant,
        query.plate ?? null,
        query.phone ?? null,
        byPhone.id,
        byPlate.customer_id,
      );
    }

    const customer =
      byPhone ??
      (byPlate ? await this.repo.findById(tenant, byPlate.customer_id) : null);
    if (!customer) {
      return {
        found: false,
        matched_by: null,
        customer: null,
        vehicles: [],
        vehicle: null,
        stats: null,
      };
    }

    const [vehicles, stats] = await Promise.all([
      this.repo.listVehicles(tenant, customer.id),
      this.repo.getStats(tenant, customer.id),
    ]);
    return {
      found: true,
      matched_by: byPlate ? 'plate' : 'phone',
      customer,
      vehicles,
      // the car typed by plate; for a phone match with exactly one car it is
      // selected automatically, with several the client lets the user pick
      vehicle: byPlate ?? (vehicles.length === 1 ? vehicles[0] : null),
      stats: {
        visit_count: stats.orders_count,
        last_visit_at: stats.last_order_at,
        total_spent: stats.total_spent,
      },
    };
  }

  async listVehicles(tenant: TenantContext, user: JwtPayload, id: string) {
    await this.findById(tenant, user, id);
    return this.repo.listVehicles(tenant, id);
  }

  async addVehicle(
    tenant: TenantContext,
    user: JwtPayload,
    id: string,
    dto: CreateVehicleDto,
  ) {
    await this.findById(tenant, user, id);
    return this.insertVehicle(tenant, id, dto);
  }

  async updateVehicle(
    tenant: TenantContext,
    user: JwtPayload,
    customerId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ) {
    await this.findById(tenant, user, customerId);
    const vehicle = await this.repo.findVehicle(tenant, customerId, vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const payload: { plate?: string; size?: string | null } = {};
    if (dto.size !== undefined) payload.size = dto.size || null;
    if (dto.plate !== undefined) {
      const plateN = normalizePlate(dto.plate);
      if (!plateN) throw new BadRequestException('plate must not be empty');
      const clash = await this.repo.findVehicleByPlate(tenant, plateN);
      if (clash && clash.id !== vehicleId) {
        throw new ConflictException({
          message: 'This plate is already registered to another customer',
          reasonCode: 'plate_already_registered',
        });
      }
      payload.plate = dto.plate.trim();
    }
    if (Object.keys(payload).length === 0) return vehicle;
    try {
      const updated = await this.repo.updateVehicle(tenant, vehicleId, payload);
      await this.syncPlateColumn(tenant, customerId);
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'This plate is already registered to another customer',
          reasonCode: 'plate_already_registered',
        });
      }
      throw err;
    }
  }

  async removeVehicle(
    tenant: TenantContext,
    user: JwtPayload,
    customerId: string,
    vehicleId: string,
  ) {
    await this.findById(tenant, user, customerId);
    const vehicle = await this.repo.findVehicle(tenant, customerId, vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    await this.repo.softDeleteVehicle(tenant, vehicleId);
    await this.syncPlateColumn(tenant, customerId);
    return { message: 'Vehicle removed' };
  }

  /**
   * The customers list shows customers.plate_number, a denormalised copy of
   * the first car. Keep it in step with the cars table after any car change,
   * otherwise an edited plate never shows in the list.
   */
  private async syncPlateColumn(tenant: TenantContext, customerId: string) {
    try {
      const vehicles = await this.repo.listVehicles(tenant, customerId);
      const first = vehicles[0]?.plate ?? null;
      await this.repo.update(tenant, customerId, {
        plate_number: first,
      });
    } catch {
      // Best-effort denormalisation: the cars table stays the source of truth.
    }
  }

  private async insertVehicle(
    tenant: TenantContext,
    customerId: string,
    dto: CreateVehicleDto,
  ) {
    const plateN = normalizePlate(dto.plate);
    if (!plateN) throw new BadRequestException('plate must not be empty');
    const existing = await this.repo.findVehicleByPlate(tenant, plateN);
    if (existing) {
      if (existing.customer_id === customerId) return existing;
      throw new ConflictException({
        message: 'This plate is already registered to another customer',
        reasonCode: 'plate_already_registered',
      });
    }
    try {
      const created = await this.repo.createVehicle(tenant, {
        customer_id: customerId,
        plate: dto.plate.trim(),
        size: dto.size ?? null,
        model: dto.model ?? null,
        colour: dto.colour ?? null,
      });
      await this.syncPlateColumn(tenant, customerId);
      return created;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'This plate is already registered to another customer',
          reasonCode: 'plate_already_registered',
        });
      }
      throw err;
    }
  }

  /**
   * Called by the sale path when `customer_capture` is sent. Resolves (or
   * creates) the customer and the car, idempotently: the same phone/plate
   * always resolves to the same rows, so a retried sale never duplicates.
   */
  async resolveCapture(
    tenant: TenantContext,
    user: JwtPayload,
    capture: CustomerCaptureDto,
    explicitCustomerId?: string,
  ): Promise<{
    customer_id: string;
    vehicle: { id: string; plate: string; size: string | null } | null;
  } | null> {
    const plateN = normalizePlate(capture.plate);
    const phoneN = normalizePhone(capture.phone);
    // A capture with no phone/plate can still carry real data entered at the
    // POS (a name, or a value in any tenant-defined field). It must create the
    // customer instead of silently dropping that data and the sale's customer.
    // Without a phone/plate there is nothing to match an existing customer on,
    // so such a capture always creates a new one (the sale_attempt_id check in
    // InvoicesService already prevents a re-sent sale from running this twice).
    const hasCustomValue = Object.values(capture.custom_fields ?? {}).some(
      (v) => v !== null && v !== undefined && String(v).trim() !== '',
    );
    const hasName = !!capture.name?.trim();
    if (
      !plateN &&
      !phoneN &&
      !explicitCustomerId &&
      !hasCustomValue &&
      !hasName
    ) {
      return null;
    }

    const byPhone = phoneN
      ? await this.repo.findByPhoneNormalized(tenant, phoneN)
      : null;
    let vehicle = plateN
      ? await this.repo.findVehicleByPlate(tenant, plateN)
      : null;

    if (byPhone && vehicle && vehicle.customer_id !== byPhone.id) {
      await this.conflict(
        tenant,
        capture.plate ?? null,
        capture.phone ?? null,
        byPhone.id,
        vehicle.customer_id,
      );
    }
    let customerId: string | undefined =
      byPhone?.id ?? vehicle?.customer_id ?? undefined;

    if (explicitCustomerId) {
      if (customerId && customerId !== explicitCustomerId) {
        await this.conflict(
          tenant,
          capture.plate ?? null,
          capture.phone ?? null,
          explicitCustomerId,
          customerId,
        );
      }
      customerId = explicitCustomerId;
    }

    if (!customerId) {
      // The phone/plate typed in the smart box also fill the tenant's
      // phone / plate_number custom fields (they may be marked required).
      const defs = await this.fieldDefinitionsRepo.findAll(tenant, true);
      const customFields = { ...(capture.custom_fields ?? {}) };
      const fill = (role: string, value?: string) => {
        const key = defs.find((d) => d.contact_role === role)?.field_key;
        if (key && value && customFields[key] === undefined) {
          customFields[key] = value.trim();
        }
      };
      fill('phone', capture.phone);
      fill('plate_number', capture.plate);
      const created = await this.create(
        tenant,
        user,
        {
          full_name: capture.name?.trim() ?? '',
          phone: capture.phone?.trim() || undefined,
          custom_fields: customFields,
        },
        { allowEmpty: true },
      );
      customerId = created.id;
    }

    if (plateN && !vehicle) {
      vehicle = await this.insertVehicle(tenant, customerId, {
        plate: capture.plate,
        size: capture.size,
      });
    }
    if (vehicle && capture.size && vehicle.size !== capture.size) {
      await this.repo.updateVehicleSize(tenant, vehicle.id, capture.size);
      vehicle = { ...vehicle, size: capture.size };
    }

    return {
      customer_id: customerId,
      vehicle: vehicle
        ? { id: vehicle.id, plate: vehicle.plate, size: vehicle.size ?? null }
        : null,
    };
  }

  async getHistory(tenant: TenantContext, user: JwtPayload, id: string) {
    const customer = await this.findById(tenant, user, id);
    const [stats, recent_orders] = await Promise.all([
      this.repo.getStats(tenant, id),
      this.repo.getHistory(tenant, id),
    ]);
    return { customer, stats, recent_orders };
  }
}
