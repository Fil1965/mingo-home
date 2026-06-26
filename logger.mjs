import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, 'logs');
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
