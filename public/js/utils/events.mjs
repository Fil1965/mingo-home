/**
 * Mini pub/sub para desacoplar modulos de UI.
 */

const listeners = new Map();

export function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => off(event, callback);
}

export function off(event, callback) {
    const set = listeners.get(event);
    if (set) set.delete(callback);
}

export function emit(event, data) {
    const set = listeners.get(event);
    if (set) {
        // Ejecutar listeners de forma asincrona para evitar que un error bloquee otros
        setTimeout(() => {
            set.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`Error en listener de ${event}:`, e);
                }
            });
        }, 0);
    }
}
