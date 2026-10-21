import { useEffect, useState } from 'react';
import { TONO_ESTADO } from '../utilidades/formato.js';
import { Celdas } from './Celdas.jsx';
import { Marca } from './Marca.jsx';

// Tablero de ejemplo (datos ficticios) que muestra cómo cambian los estados de una reserva.
const FILAS = [
  { codigo: 'PO14', barrio: 'Pocitos', franja: '09–13', estados: ['RETENIDA', 'CONFIRMADA'] },
  { codigo: 'PC31', barrio: 'Punta Carretas', franja: '14–18', estados: ['CONFIRMADA'] },
  { codigo: 'CO27', barrio: 'Cordón', franja: '08–12', estados: ['LIBRE', 'RETENIDA', 'EXPIRADA', 'LIBRE'] },
  { codigo: 'CV11', barrio: 'Ciudad Vieja', franja: '10–11', estados: ['RETENIDA', 'CANCELADA', 'LIBRE'] },
  { codigo: 'BU52', barrio: 'Buceo', franja: '19–23', estados: ['LIBRE'] },
];

function TableroEjemplo() {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPaso((p) => p + 1), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <figure>
      <table className="w-full border-separate border-spacing-y-1.5 text-left">
        <thead>
          <tr className="etiqueta">
            <th scope="col" className="pb-1 font-semibold">Código</th>
            <th scope="col" className="pb-1 font-semibold">Barrio</th>
            <th scope="col" className="pb-1 font-semibold">Franja</th>
            <th scope="col" className="pb-1 text-right font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody className="text-xl">
          {FILAS.map((f, i) => {
            const estado = f.estados[(paso + i) % f.estados.length];
            return (
              <tr key={f.codigo}>
                <td><Celdas texto={f.codigo} largo={4} /></td>
                <td className="text-lg text-tenue">{f.barrio}</td>
                <td><Celdas texto={f.franja} largo={5} /></td>
                <td className="text-right"><Celdas texto={estado} largo={10} tono={TONO_ESTADO[estado]} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <figcaption className="mt-3 text-sm text-tenue">Ejemplo con datos ficticios.</figcaption>
    </figure>
  );
}

export function MarcoAuth({ titulo, children }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(440px,560px)]">
      <aside className="hidden flex-col justify-between gap-12 border-r border-[#1f2024] bg-paleta p-12 lg:flex">
        <Marca className="text-3xl" />
        <div className="max-w-[640px]">
          <TableroEjemplo />
        </div>
        <p className="max-w-md text-lg text-tenue">
          Reservá una cochera por franja horaria. Mientras pagás, la franja queda retenida 10 minutos y nadie más puede
          tomarla.
        </p>
      </aside>
      <main className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mb-10 lg:hidden">
          <Marca />
        </div>
        <div className="w-full max-w-md">
          <h1>
            <Celdas texto={titulo} className="text-[clamp(1.75rem,9vw,2.5rem)]" />
          </h1>
          {children}
        </div>
      </main>
    </div>
  );
}
