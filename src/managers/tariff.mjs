import moment from 'moment';
import fs from 'fs/promises';
import path from 'path';
import logger from '../logging/logger.mjs';

const redel = 'https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real';

export async function refrescarTarifa(dirname) {
    const diaTarifa = moment().format('YYYY-MM-DD');
    try {
        const url = `${redel}?start_date=${diaTarifa}T00:00&end_date=${diaTarifa}T23:59&time_trunc=hour`;
        const result = await fetch(url);
        const json = await result.json();

        logger.info(`Refrescando tarifa de electricidad ... ${diaTarifa}`);

        const values = json.included[0].attributes.values || [];
        const hourlyValues = values.filter(v => {
            const d = new Date(v.datetime);
            return d.getMinutes() === 0 && d.getSeconds() === 0;
        });

        const jsonDir = path.join(dirname, 'public', 'json');
        await fs.mkdir(jsonDir, { recursive: true });
        await fs.writeFile(path.join(jsonDir, `${diaTarifa}_rede.json`), JSON.stringify(hourlyValues, null, 2));

        return hourlyValues;
    } catch (ex) {
        logger.error({ err: ex }, 'Error al refrescar tarifa:');
        return null;
    }
}

export function horaIncluidaHoras(horasStr, horaActualNum) {
  if (!horasStr) return true;
  try {
    const parts = horasStr.toString().split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map(s => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end)) continue;
        if (start <= end) {
          if (horaActualNum >= start && horaActualNum <= end) return true;
        } else {
          // rango con wrap-around, ej 20-6
          if (horaActualNum >= start || horaActualNum <= end) return true;
        }
      } else {
        const h = parseInt(part, 10);
        if (!isNaN(h) && horaActualNum === h) return true;
      }
    }
    return false;
  } catch (e) {
    logger.error({ err: e }, 'Error parseando Horas:');
    return false;
  }
}

export function isCurrentHourAmongCheapest(tarifa, n, horasStr) {
    if (!tarifa || tarifa.length === 0) return false;

    const now = new Date();
    const localHour = now.getHours();
    const localDate = now.toISOString().slice(0, 10);

    // Filtrar tarifa únicamente para hoy
    const tarifaHoy = tarifa.filter(t => new Date(t.datetime).toISOString().slice(0, 10) === localDate);

    // Si se especifican `Horas`, limitar candidatos a esas horas
    let candidatos = tarifaHoy;
    if (horasStr) {
        candidatos = tarifaHoy.filter(t => horaIncluidaHoras(horasStr, new Date(t.datetime).getHours()));
    }

    if (!candidatos || candidatos.length === 0) return false;

    const cheapest = [...candidatos]
        .sort((a, b) => a.value - b.value)
        .slice(0, n);

    return cheapest.some(t => new Date(t.datetime).getHours() === localHour);
}

export function getCurrentTarifaValue(tarifa) {
    if (!tarifa) return null;
    const now = new Date();
    const localHour = now.getHours();
    const localDate = now.toISOString().slice(0, 10);

    const item = tarifa.find(t => {
        const tDate = new Date(t.datetime);
        return (
            tDate.getHours() === localHour &&
            tDate.toISOString().slice(0, 10) === localDate
        );
    });

    return item ? item.value : null;
}