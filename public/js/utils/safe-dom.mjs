/**
 * Helpers seguros para construir HTML y manipular el DOM.
 * Cualquier interpolacion en `html` se escapa por defecto; usa `raw()` para HTML confiable.
 */

const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

export function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}

function isHtml(x) {
    return x && typeof x === 'object' && x.__html === true;
}

export function raw(str) {
    return {
        __html: true,
        toString: () => str,
        valueOf: () => str
    };
}

export function html(strings, ...values) {
    let result = '';
    for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) {
            const v = values[i];
            if (Array.isArray(v)) {
                result += v.map(x => (isHtml(x) ? String(x) : escapeHtml(x))).join('');
            } else if (isHtml(v)) {
                result += String(v);
            } else {
                result += escapeHtml(v);
            }
        }
    }
    return raw(result);
}

export function setHtml($el, markup) {
    $el.html(String(markup));
}

export function setText($el, text) {
    $el.text(text == null ? '' : String(text));
}

export function setAttr($el, attr, value) {
    $el.attr(attr, escapeHtml(value));
}

export function safeUrl(value) {
    const s = String(value || '');
    return /^javascript:/i.test(s) ? '' : s;
}
