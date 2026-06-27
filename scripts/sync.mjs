import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

let cachedConfig = null;

function loadConfig() {
    const configFile = process.env.SYNC_CONFIG || 'sync.config.json';
    const resolved = path.resolve(projectRoot, configFile);
    if (!fs.existsSync(resolved)) {
        throw new Error(`No se encontró el archivo de configuración: ${resolved}`);
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function getConfigExcludes() {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig.excludes || [];
}

export function isExcluded(relPath, excludes) {
    const list = excludes || getConfigExcludes();
    const baseName = path.basename(relPath);
    return list.some(pattern => {
        if (pattern === relPath) return true;
        if (pattern === baseName) return true;
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            if (relPath.startsWith(prefix)) return true;
            if (baseName.startsWith(prefix)) return true;
        }
        return false;
    });
}

function sync(source, destination, config, currentRelPath = '') {
    const { excludes = [], preserveInDestination = [] } = config;

    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }

    let copied = 0;
    let skipped = 0;

    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
        const relPath = currentRelPath ? `${currentRelPath}/${entry.name}` : entry.name;
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (isExcluded(relPath, excludes)) {
            skipped++;
            continue;
        }

        if (entry.isDirectory()) {
            const result = sync(srcPath, destPath, config, relPath);
            copied += result.copied;
            skipped += result.skipped;
        } else {
            if (preserveInDestination.includes(entry.name) && fs.existsSync(destPath)) {
                skipped++;
                continue;
            }
            fs.cpSync(srcPath, destPath, { force: true });
            copied++;
        }
    }

    return { copied, skipped };
}

function main() {
    const config = loadConfig();
    const destination = path.resolve(config.destination);

    // Evitar copiar el propio directorio de destino dentro de sí mismo
    // cuando está contenido en el árbol de origen.
    const destRel = path.relative(projectRoot, destination).split(path.sep).join('/');
    if (destRel && !destRel.startsWith('..') && !path.isAbsolute(destRel)) {
        config.excludes = [...(config.excludes || [])];
        if (!config.excludes.includes(destRel)) {
            config.excludes.push(destRel);
        }
    }

    console.log(`Sincronizando desde ${projectRoot} hacia ${destination}`);
    const { copied, skipped } = sync(projectRoot, destination, config);
    console.log(`Copiados: ${copied}, Omitidos: ${skipped}`);
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
    main();
}
