import { entradaInvalida } from './errores.js';

// Las franjas se manejan internamente como { diaSemana, desde, hasta } con desde y
// hasta en minutos desde la medianoche, en hora de Montevideo.

const ZONA = 'America/Montevideo';
const MINUTOS_DIA = 1440;
const MAX_FRANJAS = 50;
const HORA = /^(\d{2}):(\d{2})$/;
const DIAS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const formatoLocal = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function aMinutos(hora, campo) {
  const coincidencia = HORA.exec(hora);
  const minutos = coincidencia && Number(coincidencia[1]) * 60 + Number(coincidencia[2]);
  if (!coincidencia || Number(coincidencia[2]) > 59 || minutos > MINUTOS_DIA) {
    throw entradaInvalida(`${campo} debe tener formato HH:MM (00:00 a 24:00)`);
  }
  if (minutos % 30 !== 0) throw entradaInvalida(`${campo} debe terminar en :00 o :30`);
  return minutos;
}

export function aHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Valida las franjas que manda el propietario y las devuelve en minutos.
export function validarFranjas(franjas) {
  if (franjas.length > MAX_FRANJAS) throw entradaInvalida(`Máximo ${MAX_FRANJAS} franjas`);

  const resultado = franjas.map((f) => {
    if (!Number.isInteger(f.diaSemana) || f.diaSemana < 1 || f.diaSemana > 7) {
      throw entradaInvalida('diaSemana debe estar entre 1 (lunes) y 7 (domingo)');
    }
    const desde = aMinutos(f.horaDesde, 'horaDesde');
    const hasta = aMinutos(f.horaHasta, 'horaHasta');
    if (desde >= hasta) throw entradaInvalida('horaDesde debe ser anterior a horaHasta');
    return { diaSemana: f.diaSemana, desde, hasta };
  });

  const ordenadas = [...resultado].sort((a, b) => a.diaSemana - b.diaSemana || a.desde - b.desde);
  for (let i = 1; i < ordenadas.length; i++) {
    const anterior = ordenadas[i - 1];
    if (ordenadas[i].diaSemana === anterior.diaSemana && ordenadas[i].desde < anterior.hasta) {
      throw entradaInvalida(`Hay franjas solapadas el día ${anterior.diaSemana}`);
    }
  }
  return resultado;
}

function partesLocales(fecha) {
  const p = Object.fromEntries(formatoLocal.formatToParts(fecha).map((x) => [x.type, x.value]));
  const minutos =
    Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 + fecha.getUTCMilliseconds() / 60000;
  return { dia: DIAS[p.weekday], minutos };
}

// true si las franjas del día cubren sin huecos el tramo [desde, hasta) en minutos.
function cubreTramo(franjasDelDia, desde, hasta) {
  let alcanzado = desde;
  for (const f of [...franjasDelDia].sort((a, b) => a.desde - b.desde)) {
    if (f.desde > alcanzado) break;
    alcanzado = Math.max(alcanzado, f.hasta);
    if (alcanzado >= hasta) return true;
  }
  return alcanzado >= hasta;
}

// true si cada minuto de [desde, hasta) cae dentro de alguna franja semanal.
// Parte el intervalo en la medianoche local y revisa cada día por separado.
export function cubreFranja(franjas, desde, hasta) {
  let cursor = desde.getTime();
  const fin = hasta.getTime();
  while (cursor < fin) {
    const { dia, minutos } = partesLocales(new Date(cursor));
    const finDelDia = cursor + Math.round((MINUTOS_DIA - minutos) * 60000);
    const finTramo = Math.min(fin, finDelDia);
    const hastaMin = minutos + (finTramo - cursor) / 60000;
    if (!cubreTramo(franjas.filter((f) => f.diaSemana === dia), minutos, hastaMin)) return false;
    cursor = finTramo;
  }
  return true;
}
