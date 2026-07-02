import * as winston from 'winston';

export const devFormatter = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, module, action, tenantId, meta } = info as {
      timestamp: string;
      level: string;
      message: string;
      module?: string;
      action?: string;
      tenantId?: string;
      meta?: Record<string, unknown>;
    };

    const parts: string[] = [`[${timestamp}] ${level}`];
    if (module) parts.push(`[${module}]`);
    if (action) parts.push(`(${action})`);
    parts.push(message);
    if (tenantId && tenantId !== 'system') parts.push(`tenant:${tenantId}`);
    if (meta && Object.keys(meta).length > 0) parts.push(JSON.stringify(meta));
    return parts.join(' ');
  }),
);