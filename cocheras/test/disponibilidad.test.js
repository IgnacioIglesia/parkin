import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aHora, cubreFranja, validarFranjas } from '../src/disponibilidad.js';

// Montevideo es UTC-3 sin horario de verano: las 14:00 locales son las 17:00 UTC.
// 2026-11-02 es lunes (diaSemana 1).
const lunes = (hora) => new Date(`2026-11-02T${hora}-03:00`);
const martes = (hora) => new Date(`2026-11-03T${hora}-03:00`);

test('validarFranjas convierte HH:MM a minutos', () => {
  assert.deepEqual(validarFranjas([{ diaSemana: 1, horaDesde: '08:30', horaHasta: '24:00' }]), [
    { diaSemana: 1, desde: 510, hasta: 1440 },
  ]);
});

test('validarFranjas rechaza horas mal formadas o no alineadas a media hora', () => {
  for (const [horaDesde, horaHasta] of [['8:00', '10:00'], ['08:15', '10:00'], ['10:00', '24:30'], ['10:00', '09:00'], ['10:00', '10:00']]) {
    assert.throws(() => validarFranjas([{ diaSemana: 1, horaDesde, horaHasta }]), { extensions: { code: 'BAD_USER_INPUT' } });
  }
});

test('validarFranjas rechaza días fuera de 1 a 7', () => {
  assert.throws(() => validarFranjas([{ diaSemana: 0, horaDesde: '08:00', horaHasta: '10:00' }]));
  assert.throws(() => validarFranjas([{ diaSemana: 8, horaDesde: '08:00', horaHasta: '10:00' }]));
});

test('validarFranjas rechaza franjas solapadas del mismo día y acepta contiguas', () => {
  assert.throws(() =>
    validarFranjas([
      { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00' },
      { diaSemana: 1, horaDesde: '11:00', horaHasta: '14:00' },
    ]),
  );
  assert.equal(
    validarFranjas([
      { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00' },
      { diaSemana: 1, horaDesde: '12:00', horaHasta: '14:00' },
      { diaSemana: 2, horaDesde: '09:00', horaHasta: '13:00' },
    ]).length,
    3,
  );
});

test('aHora formatea minutos como HH:MM', () => {
  assert.equal(aHora(510), '08:30');
  assert.equal(aHora(1440), '24:00');
});

test('cubreFranja: dentro, fuera y en el borde de una franja', () => {
  const franjas = [{ diaSemana: 1, desde: 8 * 60, hasta: 18 * 60 }];
  assert.equal(cubreFranja(franjas, lunes('09:00'), lunes('12:00')), true);
  assert.equal(cubreFranja(franjas, lunes('08:00'), lunes('18:00')), true);
  assert.equal(cubreFranja(franjas, lunes('17:00'), lunes('19:00')), false);
  assert.equal(cubreFranja(franjas, martes('09:00'), martes('10:00')), false);
});

test('cubreFranja usa la hora de Montevideo, no la UTC', () => {
  const franjas = [{ diaSemana: 1, desde: 14 * 60, hasta: 15 * 60 }];
  assert.equal(cubreFranja(franjas, new Date('2026-11-02T17:00:00Z'), new Date('2026-11-02T18:00:00Z')), true);
  assert.equal(cubreFranja(franjas, new Date('2026-11-02T14:00:00Z'), new Date('2026-11-02T15:00:00Z')), false);
});

test('cubreFranja une franjas contiguas y cruza la medianoche', () => {
  const franjas = [
    { diaSemana: 1, desde: 20 * 60, hasta: 22 * 60 },
    { diaSemana: 1, desde: 22 * 60, hasta: 1440 },
    { diaSemana: 2, desde: 0, hasta: 6 * 60 },
  ];
  assert.equal(cubreFranja(franjas, lunes('21:00'), martes('05:00')), true);
  assert.equal(cubreFranja(franjas, lunes('21:00'), martes('07:00')), false);
});

test('cubreFranja detecta un hueco entre franjas', () => {
  const franjas = [
    { diaSemana: 1, desde: 8 * 60, hasta: 10 * 60 },
    { diaSemana: 1, desde: 11 * 60, hasta: 13 * 60 },
  ];
  assert.equal(cubreFranja(franjas, lunes('09:00'), lunes('12:00')), false);
});

test('cubreFranja sin franjas nunca está disponible', () => {
  assert.equal(cubreFranja([], lunes('09:00'), lunes('10:00')), false);
});
