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

export function sync(config) {
    const destination = path.resolve(config.destination);

    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }

    const excludes = [...(config.excludes || [])];
    const preserveInDestination = config.preserveInDestination || [];

    // Evitar copiar el propio directorio de destino dentro de sí mismo
    // cuando está contenido en el árbol de origen.
    const destRel = path.relative(projectRoot, destination).split(path.sep).join('/');
    const destInsideSource = destRel && !destRel.startsWith('..') && !path.isAbsolute(destRel);
    if (destInsideSource) {
        if (!excludes.includes(destRel)) {
            excludes.push(destRel);
        }
    }

    let copied = 0;
    let skipped = 0;

    function filter(sourcePath, destinationPath) {
        const relPath = path.relative(projectRoot, sourcePath).split(path.sep).join('/');
        const baseName = path.basename(relPath);
        const isFile = fs.statSync(sourcePath).isFile();

        if (isExcluded(relPath, excludes)) {
            if (isFile) skipped++;
            return false;
        }

        if (!isFile) {
            return true;
        }

        if (preserveInDestination.includes(baseName) && fs.existsSync(destinationPath)) {
            skipped++;
            return false;
        }

        copied++;
        return true;
    }

    // Cuando el destino cae dentro del árbol de origen, fs.cpSync rechaza
    // copiar el directorio raíz sobre sí mismo. En ese caso copiamos cada
    // entrada de primer nivel por separado, aprovechando el mismo filtro.
    if (destInsideSource) {
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(projectRoot, entry.name);
            const destPath = path.join(destination, entry.name);
            fs.cpSync(srcPath, destPath, { recursive: true, filter });
        }
    } else {
        fs.cpSync(projectRoot, destination, { recursive: true, filter });
    }

    return { copied, skipped };
}

function main() {
    try {
        const config = loadConfig();
        console.log(`Sincronizando desde ${projectRoot} hacia ${path.resolve(config.destination)}`);
        const { copied, skipped } = sync(config);
        console.log(`Copiados: ${copied}, Omitidos: ${skipped}`);
    } catch (err) {
        console.error(`Error de sincronización: ${err.message}`);
        process.exit(1);
    }
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
    main();
}
