import { Celdas } from './Celdas.jsx';

// Pantalla completa de carga, vacío o error, con el mismo lenguaje de celdas del tablero.
export function PantallaEstado({ celdas, tono = 'tenue', titulo, children }) {
  return (
    <div className="grid flex-1 place-items-center px-5 py-16" role={tono === 'rojo' ? 'alert' : 'status'}>
      <div className="max-w-md text-center">
        <Celdas texto={celdas} tono={tono} className="text-3xl" decorativo={Boolean(titulo)} />
        {titulo && <p className="mt-5 text-xl font-semibold text-balance">{titulo}</p>}
        {children}
      </div>
    </div>
  );
}
