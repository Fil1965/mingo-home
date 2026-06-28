import assert from 'assert';
import { horaIncluida } from '../consumptionManager.mjs';
import { horaIncluidaHoras, isCurrentHourAmongCheapest } from '../src/managers/tariff.mjs';

const today = new Date();
const date = today.toISOString().slice(0,10);
const curHour = today.getHours();

// Tests for horaIncluida
assert.strictEqual(horaIncluida(undefined, curHour), true, 'undefined -> true');
assert.strictEqual(horaIncluida('8,9,10', 9), true, 'lista incluye 9');
assert.strictEqual(horaIncluida('8,9,10', 11), false, 'lista no incluye 11');
assert.strictEqual(horaIncluida('20-6', 22), true, 'rango wrap incluye 22');
assert.strictEqual(horaIncluida('20-6', 2), true, 'rango wrap incluye 2');
assert.strictEqual(horaIncluida('20-6', 7), false, 'rango wrap no incluye 7');
assert.strictEqual(horaIncluida('20-23,6', 6), true, 'lista y rango combinados');

// horaIncluidaHoras (misma lógica)
assert.strictEqual(horaIncluidaHoras('8,9,10', 9), true, 'horaIncluidaHoras lista');
assert.strictEqual(horaIncluidaHoras('20-6', 2), true, 'horaIncluidaHoras wrap');
assert.strictEqual(horaIncluidaHoras('20-6', 7), false, 'horaIncluidaHoras fuera');

// Tests for isCurrentHourAmongCheapest
// Construimos una tarifa donde la hora actual es la más barata
const tarifa = [];
for (let h = 0; h < 24; h++) {
  const hh = String(h).padStart(2,'0');
  let value = 100 + h;
  if (h === curHour) value = 1; // hora actual más barata
  tarifa.push({ datetime: `${date}T${hh}:00:00`, value });
}

// Sin filtro de Horas debería ser true para n=1
assert.strictEqual(isCurrentHourAmongCheapest(tarifa, 1), true, 'hora actual es la más barata (n=1)');

// Si filtramos Horas fuera de la hora actual, debe ser false
const excludeStart = (curHour + 1) % 24;
const excludeEnd = (curHour + 2) % 24;
const horasExcl = `${excludeStart}-${excludeEnd}`;
assert.strictEqual(isCurrentHourAmongCheapest(tarifa, 1, horasExcl), false, 'filtrado Horas excluye hora actual');

// Si filtramos incluyendo la hora actual, debe ser true
assert.strictEqual(isCurrentHourAmongCheapest(tarifa, 1, `${curHour}`), true, 'filtrado Horas incluye hora actual');

console.log('Todos los tests pasaron ✅');
process.exit(0);
