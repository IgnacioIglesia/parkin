import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { DIAS, HORAS } from '../utilidades/formato.js';

const PRESETS = [
  { nombre: 'Lunes a viernes, 9 a 18', dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' },
  { nombre: 'Todos los días, todo el día', dias: [1, 2, 3, 4, 5, 6, 7], desde: '00:00', hasta: '24:00' },
];

const agrupar = (franjas) =>
  Object.fromEntries(
    DIAS.map((_, i) => [
      i + 1,
      franjas
        .filter((f) => f.diaSemana === i + 1)
        .map(({ horaDesde, horaHasta }) => ({ horaDesde, horaHasta }))
        .sort((a, b) => a.horaDesde.localeCompare(b.horaDesde)),
    ]),
  );

// Devuelve un mensaje por día con problemas (rangos vacíos o que se pisan), o {} si está todo bien.
export function erroresDisponibilidad(porDia) {
  const errores = {};
  for (const [dia, rangos] of Object.entries(porDia)) {
    const ordenados = [...rangos].sort((a, b) => a.horaDesde.localeCompare(b.horaDesde));
    if (ordenados.some((r) => r.horaHasta <= r.horaDesde)) errores[dia] = 'La hora de fin tiene que ser posterior a la de inicio.';
    else if (ordenados.some((r, i) => i > 0 && r.horaDesde < ordenados[i - 1].horaHasta)) errores[dia] = 'Hay horarios que se pisan.';
  }
  return errores;
}

export const aFranjas = (porDia) =>
  Object.entries(porDia).flatMap(([dia, rangos]) => rangos.map((r) => ({ diaSemana: Number(dia), ...r })));

// Horario semanal editable: rangos por día en pasos de 30 minutos (contrato: alineados a :00 o :30).
export function useDisponibilidad(inicial) {
  const [porDia, setPorDia] = useState(() => agrupar(inicial));
  const cambiarDia = (dia, rangos) => setPorDia((actual) => ({ ...actual, [dia]: rangos }));
  const aplicarPreset = (preset) =>
    setPorDia(Object.fromEntries(DIAS.map((_, i) => [i + 1, preset.dias.includes(i + 1) ? [{ horaDesde: preset.desde, horaHasta: preset.hasta }] : []])));
  return { porDia, cambiarDia, aplicarPreset, limpiar: () => setPorDia(agrupar([])) };
}

export function EditorDisponibilidad({ porDia, cambiarDia, aplicarPreset, limpiar, errores }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.nombre} type="button" className="boton boton-secundario px-3 py-2 text-base" onClick={() => aplicarPreset(p)}>
            {p.nombre}
          </button>
        ))}
        <button type="button" className="boton boton-secundario px-3 py-2 text-base" onClick={limpiar}>
          Vaciar
        </button>
      </div>

      <div className="mt-4">
        {DIAS.map((dia, i) => {
          const numero = i + 1;
          const rangos = porDia[numero];
          const actualizar = (j, campo, valor) => cambiarDia(numero, rangos.map((r, k) => (k === j ? { ...r, [campo]: valor } : r)));
          return (
            <fieldset key={dia} className="border-t border-[#1d1e22] py-3" aria-describedby={errores[numero] ? `error-dia-${numero}` : undefined}>
              <legend className="sr-only">{dia}</legend>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <span className="pt-2 font-celda text-lg font-semibold tracking-[0.06em] uppercase" aria-hidden="true">
                {dia}
              </span>
              <div className="flex flex-col gap-2">
                {rangos.length === 0 && <p className="pt-2 text-tenue">No se alquila</p>}
                {rangos.map((r, j) => (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`d${numero}-${j}-desde`}>
                      {dia}, desde
                    </label>
                    <select id={`d${numero}-${j}-desde`} className="campo w-auto py-2" value={r.horaDesde} onChange={(e) => actualizar(j, 'horaDesde', e.target.value)}>
                      {HORAS.slice(0, -1).map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                    <span className="text-tenue" aria-hidden="true">
                      a
                    </span>
                    <label className="sr-only" htmlFor={`d${numero}-${j}-hasta`}>
                      {dia}, hasta
                    </label>
                    <select id={`d${numero}-${j}-hasta`} className="campo w-auto py-2" value={r.horaHasta} onChange={(e) => actualizar(j, 'horaHasta', e.target.value)}>
                      {HORAS.slice(1).map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="grid size-10 place-items-center text-tenue hover:text-rojo"
                      onClick={() => cambiarDia(numero, rangos.filter((_, k) => k !== j))}
                      aria-label={`Quitar el horario de ${r.horaDesde} a ${r.horaHasta} del ${dia.toLowerCase()}`}
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="inline-flex w-fit items-center gap-1.5 py-1 font-semibold text-ambar hover:underline"
                  onClick={() => cambiarDia(numero, [...rangos, { horaDesde: '09:00', horaHasta: '18:00' }])}
                >
                  <Plus size={16} aria-hidden="true" /> Agregá un horario
                  <span className="sr-only"> el {dia.toLowerCase()}</span>
                </button>
                {errores[numero] && (
                  <p id={`error-dia-${numero}`} className="text-sm text-rojo">
                    {errores[numero]}
                  </p>
                )}
              </div>
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
