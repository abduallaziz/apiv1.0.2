import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from './tenant-context';

export const GetTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantContext;
  },
);