import { Link } from 'react-router';
import { Celdas } from '../componentes/Celdas.jsx';

export function NoEncontrada() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paleta px-5">
      <div className="text-center">
        <h1>
          <Celdas texto="404" tono="ambar" className="text-6xl" />
          <span className="mt-6 block text-2xl font-semibold">Esta página no existe</span>
        </h1>
        <p className="mt-2 text-tenue">Puede que el enlace esté mal escrito o que la página se haya movido.</p>
        <Link to="/buscar" className="boton boton-primario mt-8">
          Volvé a buscar
        </Link>
      </div>
    </div>
  );
}
