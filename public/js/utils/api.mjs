/**
 * Wrappers AJAX con manejo centralizado de autenticacion (401).
 * Todos devuelven Promise para poder usar async/await o .done/.fail.
 */

export function getJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        $.ajax({
            dataType: 'json',
            cache: false,
            url,
            ...options
        })
            .done(resolve)
            .fail(handleFail(reject));
    });
}

export function post(url, data, options = {}) {
    return new Promise((resolve, reject) => {
        $.ajax({
            type: 'POST',
            url,
            data,
            ...options
        })
            .done(resolve)
            .fail(handleFail(reject));
    });
}

export function postJson(url, body, options = {}) {
    return new Promise((resolve, reject) => {
        $.ajax({
            type: 'POST',
            url,
            contentType: 'application/json',
            data: JSON.stringify(body),
            ...options
        })
            .done(resolve)
            .fail(handleFail(reject));
    });
}

function handleFail(reject) {
    return function (jqXHR) {
        if (jqXHR.status === 401) {
            window.location.href = '/login';
            return;
        }
        reject(jqXHR);
    };
}
