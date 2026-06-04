import * as winston from 'winston';
import { jsonFormatter } from '../formatters/json.formatter';
import { devFormatter } from '../formatters/dev.formatter';

export function createConsoleTransport(): winston.transports.ConsoleTransportInstance {
  const isProd = process.env.NODE_ENV === 'production';
  return new winston.transports.Console({
    format: isProd ? jsonFormatter : devFormatter,
    silent: false,
  });
}