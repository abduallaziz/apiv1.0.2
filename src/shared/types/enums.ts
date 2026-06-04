export enum UserRole {
  SUPERADMIN = 'superadmin',
  OWNER = 'owner',
  MANAGER = 'manager',
  CASHIER = 'cashier',
  WORKER = 'worker',
}

export enum BusinessType {
  RESTAURANT = 'restaurant',
  CAFE = 'cafe',
  RETAIL = 'retail',
  SERVICES = 'services',
  WORKSHOP = 'workshop',
  OTHER = 'other',
}

export enum TenantStatus {
  ACTIVE = 'active',
  TRIAL = 'trial',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
}

export enum ItemType {
  PRODUCT = 'product',
  SERVICE = 'service',
  CUSTOM = 'custom',
}

export enum OperationType {
  SELL = 'sell',
  BOOK = 'book',
  REPAIR = 'repair',
  RENT = 'rent',
}

export enum OrderStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ExpenseStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum ShiftStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  TRIAL = 'trial',
}

export enum DeviceType {
  WEB = 'web',
  MOBILE = 'mobile',
}