import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { misCocheras } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { Celdas } from '../componentes/Celdas.jsx';
import { PantallaEstado } from '../componentes/PantallaEstado.jsx';
import { codigoCochera, formatoPesos, nombreTipo } from '../utilidades/formato.js';

const diasConHorario = (franjas) => new Set(franjas.map((f) => f.diaSemana)).size;

export function MisCocheras() {
  const navegar = useNavigate();
  const [cocheras, setCocheras] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  useEffect(() => {
    misCocheras()
      .then((lista) => {
        setCocheras(lista);
        setEstado('listo');
      })
      .catch((err) => {
        setError(err);
        setEstado('error');
      });
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-celda text-[2rem] font-semibold tracking-[0.04em] uppercase">Tus cocheras</h1>
        <Link to="/mis-cocheras/nueva" className="boton boton-primario">
          <Plus size={18} aria-hidden="true" /> Publicá una cochera
        </Link>
      </div>

      {estado === 'cargando' && <PantallaEstado celdas="Cargando" />}
      {estado === 'error' && <PantallaEstado celdas="Error" tono="rojo" titulo={mensajeDeError(error)} />}

      {estado === 'listo' && cocheras.length === 0 && (
        <PantallaEstado celdas="Sin cocheras" titulo="Todavía no publicaste ninguna cochera">
          <p className="mt-2 text-tenue">Publicala con su ubicación y precio, y definí qué días y horarios se puede alquilar.</p>
        </PantallaEstado>
      )}

      {estado === 'listo' && cocheras.length > 0 && (
        <div className="panel mt-6 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-left text-[1.0625rem]">
            <thead>
              <tr className="etiqueta">
                <th scope="col" className="py-3 pr-2 pl-5 font-semibold">Código</th>
                <th scope="col" className="px-2 py-3 font-semibold">Cochera</th>
                <th scope="col" className="px-2 py-3 text-right font-semibold">Por hora</th>
                <th scope="col" className="py-3 pr-5 pl-2 text-right font-semibold">Horarios</th>
              </tr>
            </thead>
            <tbody>
              {cocheras.map((c) => {
                const dias = diasConHorario(c.disponibilidad);
                return (
                  <tr key={c.id} className="cursor-pointer border-t border-[#1d1e22] hover:bg-celda" onClick={() => navegar(`/mis-cocheras/${c.id}`)}>
                    <td className="py-3 pr-2 pl-5">
                      <Celdas texto={codigoCochera(c)} largo={4} tono="ambar" className="text-[1.375rem]" decorativo />
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/mis-cocheras/${c.id}`} className="font-medium hover:text-ambar" onClick={(e) => e.stopPropagation()}>
                        {c.titulo}
                      </Link>
                      <div className="text-[0.875rem] text-tenue">
                        {nombreTipo(c.tipoVehiculo)} · {c.direccionExacta}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <Celdas texto={formatoPesos(c.precioHora)} className="text-[1.375rem]" />
                    </td>
                    <td className="py-3 pr-5 pl-2 text-right">
                      {dias === 0 ? (
                        <Celdas texto="Sin definir" tono="rojo" className="text-[1.375rem]" />
                      ) : (
                        <Celdas texto={`${dias} ${dias === 1 ? 'día' : 'días'}`} className="text-[1.375rem]" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cocheras.some((c) => c.disponibilidad.length === 0) && (
            <p className="border-t border-[#1d1e22] px-5 py-3 text-tenue">
              Las cocheras sin horarios no aparecen en la búsqueda hasta que los definas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
