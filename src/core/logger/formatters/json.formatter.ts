import * as winston from 'winston';
import { SERVICE_NAME } from '../logger.constants';

export const jsonFormatter = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...rest } = info;
    const log = {
      timestamp,
      level,
      message,
      service: SERVICE_NAME,
      ...rest,
    };
    return JSON.stringify(log);
  }),
);