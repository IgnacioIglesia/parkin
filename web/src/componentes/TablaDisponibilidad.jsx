import { DIAS } from '../utilidades/formato.js';
import { Celdas } from './Celdas.jsx';

// Horario semanal en filas de tablero: un renglón por día con sus franjas.
export function TablaDisponibilidad({ franjas, className = '' }) {
  const porDia = DIAS.map((_, i) =>
    franjas.filter((f) => f.diaSemana === i + 1).sort((a, b) => a.horaDesde.localeCompare(b.horaDesde)),
  );

  return (
    <table className={`w-full border-collapse text-left ${className}`}>
      <thead className="sr-only">
        <tr>
          <th scope="col">Día</th>
          <th scope="col">Horarios</th>
        </tr>
      </thead>
      <tbody>
        {DIAS.map((dia, i) => (
          <tr key={dia} className="border-t border-[#1d1e22]">
            <th scope="row" className="w-28 py-2.5 pr-3 text-left font-celda text-lg font-semibold tracking-[0.06em] uppercase">
              {dia.slice(0, 3)}
            </th>
            <td className="py-2.5">
              {porDia[i].length === 0 ? (
                <span className="text-tenue">No se alquila</span>
              ) : (
                <span className="flex flex-wrap gap-x-4 gap-y-2">
                  {porDia[i].map((f) => (
                    <Celdas key={f.horaDesde} texto={`${f.horaDesde}–${f.horaHasta}`} className="text-lg" />
                  ))}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
