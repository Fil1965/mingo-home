import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the project root from this module's location.
 *
 * This file lives at `<root>/src/logging/logger.mjs`, so the root is two
 * levels up. If this file is ever moved to a different depth, update the
 * number of `..` segments accordingly.
 */
function resolveProjectRoot(importMetaUrl) {
    const here = path.dirname(fileURLToPath(importMetaUrl));
    return path.resolve(here, '..', '..');
}

const projectRoot = resolveProjectRoot(import.meta.url);
const logDir = path.join(projectRoot, 'logs');
const logFile = path.join(logDir, 'server.log');

fs.mkdirSync(logDir, { recursive: true });

const isDev = process.env.NODE_ENV !== 'production';

const targets = [
    {
        target: 'pino/file',
        options: { destination: logFile, append: true, mkdir: true },
        level: process.env.LOG_LEVEL || 'info'
    }
];

if (isDev) {
    targets.push({
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname'
        },
        level: process.env.LOG_LEVEL || 'info'
    });
}

const transport = pino.transport({ targets });

const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, transport);

export default logger;
export { logFile };