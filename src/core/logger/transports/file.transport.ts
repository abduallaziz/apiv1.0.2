import * as winston from 'winston';
import { jsonFormatter } from '../formatters/json.formatter';

export function createFileTransports(): winston.transport[] {
  if (process.env.NODE_ENV !== 'production') {
    return [];
  }

  const DailyRotateFile = require('winston-daily-rotate-file');

  const errorTransport = new DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: '14d',
    maxSize: '20m',
    format: jsonFormatter,
    zippedArchive: true,
  });

  const combinedTransport = new DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '7d',
    maxSize: '50m',
    format: jsonFormatter,
    zippedArchive: true,
  });

  return [errorTransport, combinedTransport];
}