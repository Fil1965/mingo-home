/**
 * Helpers de formato, decodificacion y mapas de datos.
 */

export const TUYA_CATEGORIES = {
    'aqcz': 'Medidor con interruptor',
    'dj': 'Luz',
    'xdd': 'Luz de techo',
    'fwd': 'Luz de ambiente',
    'dc': 'Luces de cadena',
    'dd': 'Tira de luces',
    'gyd': 'Luz con sensor de movimiento',
    'fsd': 'Ventilador de techo con luz',
    'tyndj': 'Luz solar',
    'tgq': 'Atenuador',
    'ykq': 'Control remoto',
    'kg': 'Interruptor',
    'pc': 'Regleta',
    'cz': 'Enchufe',
    'cjkg': 'Interruptor de escena',
    'ckqdkg': 'Interruptor de tarjeta',
    'clkg': 'Interruptor de cortina',
    'ckmkzq': 'Abridor de puerta de garaje',
    'tgkg': 'Interruptor de atenuacion',
    'rs': 'Calentador de agua',
    'xfj': 'Sistema de ventilacion',
    'bx': 'Nevera',
    'yg': 'Banera',
    'xy': 'Lavadora',
    'kt': 'Aire acondicionado',
    'ktkzq': 'Controlador de aire acondicionado',
    'bgl': 'Caldera mural',
    'sd': 'Robot aspirador',
    'qn': 'Calentador',
    'kj': 'Purificador de aire',
    'lyj': 'Tendedero',
    'xxj': 'Difusor',
    'cl': 'Cortina',
    'mc': 'Controlador de puerta/ventana',
    'wk': 'Termostato',
    'yb': 'Calentador de bano',
    'ggq': 'Irrigador',
    'jsq': 'Humidificador',
    'cs': 'Deshumidificador',
    'fs': 'Ventilador',
    'js': 'Purificador de agua',
    'dr': 'Manta electrica',
    'cwtswsq': 'Alimentador de golosinas para mascotas',
    'cwwqfsq': 'Lanzador de pelotas para mascotas',
    'ntq': 'HVAC',
    'cwwsq': 'Alimentador de mascotas',
    'cwysj': 'Fuente para mascotas',
    'sf': 'Sofa',
    'dbl': 'Chimenea electrica',
    'tnq': 'Hervidor de leche inteligente',
    'msp': 'Inodoro para gatos',
    'mjj': 'Toallero',
    'sz': 'Jardin interior inteligente',
    'bh': 'Hervidor inteligente',
    'mb': 'Panificadora',
    'kfj': 'Cafetera',
    'nnq': 'Calentador de biberones',
    'cn': 'Dispensador de leche',
    'mzj': 'Cocina sous vide',
    'mg': 'Gabinete de arroz',
    'dcl': 'Placa de induccion',
    'kqzg': 'Freidora de aire',
    'znfh': 'Fiambrera',
    'mal': 'Anfitrion de alarma',
    'sp': 'Camara inteligente',
    'sgbj': 'Sirena de alarma',
    'zd': 'Sensor de vibracion',
    'mcs': 'Sensor de contacto',
    'rqbj': 'Alarma de gas',
    'ywbj': 'Alarma de humo',
    'wsdcg': 'Sensor de temperatura y humedad',
    'sj': 'Detector de fugas de agua',
    'ylcg': 'Sensor de presion',
    'ldcg': 'Sensor de iluminancia',
    'sos': 'Boton de emergencia',
    'pm2.5': 'Detector de PM2.5',
    'pir': 'Sensor de movimiento humano',
    'cobj': 'Detector de CO',
    'co2bj': 'Detector de CO2',
    'dgnbj': 'Alarma multifuncional',
    'jwbj': 'Detector de metano',
    'hps': 'Sensor de presencia humana',
    'ms': 'Cerradura residencial',
    'bxx': 'Caja fuerte',
    'gyms': 'Cerradura comercial',
    'jtmspro': 'Cerradura residencial pro',
    'hotelms': 'Cerradura de hotel',
    'ms_category': 'Accesorios de cerradura',
    'jtmsbh': 'Cerradura inteligente (keep alive)',
    'mk': 'Control de acceso',
    'videolock': 'Cerradura con camara',
    'photolock': 'Cerradura de audio y video',
    'amy': 'Sillon de masaje',
    'liliao': 'Producto de fisioterapia',
    'ts': 'Cuerda de saltar inteligente',
    'tzc1': 'Bascula de grasa corporal',
    'sb': 'Reloj/pulsera',
    'zndb': 'Medidor de electricidad inteligente',
    'znsb': 'Medidor de agua inteligente',
    'dlq': 'Disyuntor',
    'ds': 'Televisor',
    'tyy': 'Proyector',
    'tracker': 'Rastreador',
    'znyh': 'Pastillero inteligente',
    'tdq': 'Mini Interruptor',
    'wnykq': 'Infrarojos'
};

export function numberFormat(number, decimals, decPoint, thousandsSep) {
    const n = !isFinite(+number) ? 0 : +number;
    const prec = !isFinite(+decimals) ? 0 : Math.abs(decimals);
    const sep = thousandsSep === undefined ? ',' : thousandsSep;
    const dec = decPoint === undefined ? '.' : decPoint;
    const toFixedFix = (num, p) => {
        const k = Math.pow(10, p);
        return '' + Math.round(num * k) / k;
    };
    const s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
    if (s[0].length > 3) {
        s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
    }
    if ((s[1] || '').length < prec) {
        s[1] = s[1] || '';
        s[1] += new Array(prec - s[1].length + 1).join('0');
    }
    return s.join(dec);
}

export function formatCurrency(value, options = {}) {
    const fraction = options.fraction ?? 2;
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction
    }).format(value);
}

export function formatNumber(value, options = {}) {
    return new Intl.NumberFormat('de-DE', options).format(value);
}

export function decodePhaseA(b64) {
    try {
        const bin = atob(b64);
        const dec = Array.from(bin).map(c => c.charCodeAt(0));
        if (dec.length >= 8) {
            return {
                voltage: (dec[0] * 256 + dec[1]) / 10.0,
                current: (dec[2] * 1024 + (dec[3] << 8) + dec[4]) / 1000.0,
                power: (dec[5] * 1024 + (dec[6] << 8) + dec[7])
            };
        }
    } catch {
        // fallthrough
    }
    return null;
}

export function getBatteryIcon(state) {
    if (state === 'low') return { cls: 'bi-battery-low', color: 'text-danger' };
    if (state === 'middle') return { cls: 'bi-battery-half', color: '' };
    if (state === 'high') return { cls: 'bi-battery-full', color: 'text-success' };
    return null;
}

export function getSwitchStatus(statusList) {
    return statusList && statusList.find(s =>
        s.code === 'switch_1' || s.code === 'switch' || s.code === 'switch_led'
    );
}

export function formatDate(date) {
    return String(date.getDate()).padStart(2, '0') + '/' +
        String(date.getMonth() + 1).padStart(2, '0') + '/' +
        date.getFullYear();
}

export function parseDate(str) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d);
}

export function isoDate(date) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}
