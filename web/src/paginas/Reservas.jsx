import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { cocherasPorIds } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { listarReservas } from '../api/reservas.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Celdas } from '../componentes/Celdas.jsx';
import { useEventoReserva } from '../componentes/Notificaciones.jsx';
import { PantallaEstado } from '../componentes/PantallaEstado.jsx';
import { codigoCochera, etiquetaFranja, formatoPesos, NOMBRE_ESTADO, TONO_ESTADO } from '../utilidades/formato.js';

const ORDEN = { PENDIENTE_PAGO: 0, CONFIRMADA: 1, FINALIZADA: 2, CANCELADA: 3, EXPIRADA: 3 };

// Primero lo que necesita atención (retenidas y confirmadas), después por fecha más próxima.
const ordenar = (a, b) => ORDEN[a.estado] - ORDEN[b.estado] || new Date(a.desde) - new Date(b.desde);

const pestana = (activa) =>
  `inline-flex h-11 items-center border-b-2 px-1 font-celda text-lg font-semibold tracking-[0.06em] uppercase ${
    activa ? 'border-ambar text-letra' : 'border-transparent text-tenue hover:text-letra'
  }`;

export function Reservas() {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const esPropietario = usuario.roles.includes('PROPIETARIO');
  const rol = esPropietario && params.get('rol') === 'propietario' ? 'propietario' : 'conductor';

  const [reservas, setReservas] = useState([]);
  const [cocheras, setCocheras] = useState(new Map());
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const lista = (await listarReservas(rol)).sort(ordenar);
      setReservas(lista);
      setCocheras(await cocherasPorIds(lista.map((r) => r.cochera_id)).catch(() => new Map()));
      setEstado('listo');
    } catch (err) {
      setError(err);
      setEstado('error');
    }
  }, [rol]);

  useEffect(() => {
    setEstado('cargando');
    cargar();
  }, [cargar]);

  useEventoReserva(useCallback(() => cargar(), [cargar]));

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <h1 className="font-celda text-[2rem] font-semibold tracking-[0.04em] uppercase">Reservas</h1>
      {esPropietario && (
        <nav className="mt-4 flex gap-6 border-b border-[#26282c]" aria-label="Tipo de reserva">
          <button type="button" className={pestana(rol === 'conductor')} aria-current={rol === 'conductor' ? 'page' : undefined} onClick={() => setParams({})}>
            Las que hiciste
          </button>
          <button type="button" className={pestana(rol === 'propietario')} aria-current={rol === 'propietario' ? 'page' : undefined} onClick={() => setParams({ rol: 'propietario' })}>
            En tus cocheras
          </button>
        </nav>
      )}

      {estado === 'cargando' && <PantallaEstado celdas="Cargando" />}
      {estado === 'error' && <PantallaEstado celdas="Error" tono="rojo" titulo={mensajeDeError(error)} />}

      {estado === 'listo' && reservas.length === 0 && (
        <PantallaEstado celdas="Sin reservas" titulo={rol === 'conductor' ? 'Todavía no hiciste ninguna reserva' : 'Todavía nadie reservó tus cocheras'}>
          {rol === 'conductor' && (
            <Link to="/buscar" className="boton boton-primario mt-6">
              Buscá una cochera
            </Link>
          )}
        </PantallaEstado>
      )}

      {estado === 'listo' && reservas.length > 0 && (
        <div className="panel mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[1.0625rem]">
            <thead>
              <tr className="etiqueta">
                <th scope="col" className="py-3 pr-2 pl-5 font-semibold">Código</th>
                <th scope="col" className="px-2 py-3 font-semibold">Cochera</th>
                <th scope="col" className="px-2 py-3 font-semibold">Franja</th>
                <th scope="col" className="px-2 py-3 text-right font-semibold">Monto</th>
                <th scope="col" className="py-3 pr-5 pl-2 text-right font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => {
                const cochera = cocheras.get(r.cochera_id);
                return (
                  <tr key={r.id} className="cursor-pointer border-t border-[#1d1e22] hover:bg-celda" onClick={() => navegar(`/reservas/${r.id}`)}>
                    <td className="py-3 pr-2 pl-5">
                      <Celdas texto={cochera ? codigoCochera(cochera) : '----'} largo={4} className="text-[1.375rem]" decorativo />
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/reservas/${r.id}`} className="font-medium hover:text-ambar" onClick={(e) => e.stopPropagation()}>
                        {cochera?.titulo ?? 'Cochera dada de baja'}
                      </Link>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-tenue first-letter:uppercase">{etiquetaFranja(r.desde, r.hasta)}</td>
                    <td className="px-2 py-3 text-right">
                      <Celdas texto={formatoPesos(r.monto)} className="text-[1.375rem]" />
                    </td>
                    <td className="py-3 pr-5 pl-2 text-right">
                      <Celdas texto={NOMBRE_ESTADO[r.estado] ?? r.estado} largo={10} tono={TONO_ESTADO[r.estado]} className="text-[1.375rem]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
