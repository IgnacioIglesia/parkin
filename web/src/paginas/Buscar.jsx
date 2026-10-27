import { AlertTriangle, ArrowRight, LockKeyhole, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { buscarCocheras, usandoMocks } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { Celdas } from '../componentes/Celdas.jsx';
import { Mapa } from '../componentes/Mapa.jsx';
import { useBarra } from '../componentes/Shell.jsx';
import { useReservar } from '../utilidades/useReservar.js';
import {
  BARRIOS,
  barrioMasCercano,
  codigoCochera,
  distanciaMetros,
  etiquetaFranja,
  formatoDistancia,
  formatoHoras,
  formatoPesos,
  franjaInicial,
  horasEntre,
  nombreTipo,
  TIPOS_VEHICULO,
  validarFranja,
} from '../utilidades/formato.js';

const RADIO_METROS = 1500;
const PUNTO_PROPIO = 'punto-en-el-mapa';

function FormBusqueda({ form, puntoPropio, invalido, onCambiar, onBuscar, buscando }) {
  return (
    <form
      className="grid grid-cols-2 gap-2 sm:grid-cols-[0.85fr_1.2fr_1.2fr_0.75fr_auto] sm:items-stretch"
      onSubmit={(e) => {
        e.preventDefault();
        onBuscar();
      }}
    >
      <label className="caja col-span-2 sm:col-span-1">
        <span className="etiqueta">Dónde</span>
        <select value={form.lugar} onChange={(e) => onCambiar({ lugar: e.target.value })}>
          {puntoPropio && <option value={PUNTO_PROPIO}>Punto elegido en el mapa</option>}
          {BARRIOS.map((b) => (
            <option key={b.nombre} value={b.nombre}>
              {b.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="caja">
        <span className="etiqueta">Desde</span>
        <input
          type="datetime-local"
          step={1800}
          value={form.desde}
          onChange={(e) => onCambiar({ desde: e.target.value })}
          aria-invalid={invalido === 'desde' || undefined}
          aria-describedby={invalido === 'desde' ? 'busqueda-error' : undefined}
          required
        />
      </label>
      <label className="caja">
        <span className="etiqueta">Hasta</span>
        <input
          type="datetime-local"
          step={1800}
          value={form.hasta}
          onChange={(e) => onCambiar({ hasta: e.target.value })}
          aria-invalid={invalido === 'hasta' || undefined}
          aria-describedby={invalido === 'hasta' ? 'busqueda-error' : undefined}
          required
        />
      </label>
      <label className="caja">
        <span className="etiqueta">Vehículo</span>
        <select value={form.tipo} onChange={(e) => onCambiar({ tipo: e.target.value })}>
          {TIPOS_VEHICULO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="boton boton-primario" disabled={buscando}>
        <Search size={18} aria-hidden="true" />
        Buscá
      </button>
    </form>
  );
}

function Detalle({ cochera, busqueda, alConflicto }) {
  const horas = horasEntre(busqueda.desde, busqueda.hasta);
  const { reservar, enviando, error } = useReservar();
  const consulta = new URLSearchParams({ desde: busqueda.desde, hasta: busqueda.hasta }).toString();

  // Tras un 409 la cochera ya no está libre en esa franja: el tablero avisa y se actualiza.
  useEffect(() => {
    if (error?.status === 409) alConflicto(cochera.codigo, error.message);
  }, [error, alConflicto, cochera.codigo]);

  return (
    <section className="border-t border-[#26282c] bg-celda px-5 py-5 lg:px-6" aria-labelledby="detalle-titulo">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Celdas texto={cochera.codigo} tono="ambar" className="text-xl" />
          <h2 id="detalle-titulo" className="mt-2 text-xl leading-tight font-semibold text-balance">
            {cochera.titulo}
          </h2>
          <p className="mt-1 text-tenue">
            {cochera.barrio} · a {formatoDistancia(cochera.distancia)} · {nombreTipo(cochera.tipoVehiculo)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="etiqueta">Total por {formatoHoras(horas)}</p>
          <Celdas texto={formatoPesos(cochera.precioHora * horas)} className="mt-1 text-2xl" />
        </div>
      </div>
      <p className="mt-4 flex gap-2 text-base text-tenue">
        <LockKeyhole size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        Ves una ubicación aproximada. La dirección exacta aparece cuando la reserva queda confirmada.
      </p>
      {error && (
        <p className="mt-4 bg-rojo/10 px-4 py-3" role="alert">
          {error.status === 409 ? `${error.message}. Elegí otra cochera u otro horario.` : mensajeDeError(error)}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          className="boton boton-primario flex-1"
          onClick={() => reservar({ cocheraId: cochera.id, desde: busqueda.desde, hasta: busqueda.hasta })}
          disabled={enviando}
        >
          {enviando ? 'Reservando…' : 'Reservá esta franja'}
        </button>
        <Link to={`/cocheras/${cochera.id}?${consulta}`} className="inline-flex items-center gap-1.5 font-semibold text-ambar underline">
          Ver la ficha <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <p className="mt-2 text-sm text-tenue">Al reservar, la franja queda retenida 10 minutos mientras pagás.</p>
    </section>
  );
}

export function Buscar() {
  const barra = useBarra();
  const [form, setForm] = useState(() => ({ lugar: 'Pocitos', tipo: 'AUTO', ...franjaInicial() }));
  const [puntoPropio, setPuntoPropio] = useState(null);
  const [busqueda, setBusqueda] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [campoInvalido, setCampoInvalido] = useState(null);
  const [seleccionadaId, setSeleccionadaId] = useState(null);
  const ultimoPedido = useRef(0);

  const centroDe = (lugar, punto) =>
    lugar === PUNTO_PROPIO && punto ? { ...punto, nombre: 'el punto elegido' } : BARRIOS.find((b) => b.nombre === lugar);

  const buscar = useCallback(async (params, punto) => {
    const problema = validarFranja(params);
    if (problema) {
      ++ultimoPedido.current; // descarta cualquier búsqueda en vuelo
      setError(problema.mensaje);
      setCampoInvalido(problema.campo);
      setEstado('error');
      return;
    }
    const centro = centroDe(params.lugar, punto);
    const pedido = ++ultimoPedido.current;
    setEstado('cargando');
    setError(null);
    setCampoInvalido(null);
    try {
      const desde = new Date(params.desde).toISOString();
      const hasta = new Date(params.hasta).toISOString();
      const lista = await buscarCocheras({
        cerca: { lat: centro.lat, lng: centro.lng },
        radioMetros: RADIO_METROS,
        desde,
        hasta,
        tipo: params.tipo,
      });
      if (pedido !== ultimoPedido.current) return; // llegó tarde: ya hay una búsqueda más nueva
      const cocheras = lista
        .map((c) => ({
          ...c,
          codigo: codigoCochera(c),
          barrio: barrioMasCercano(c.ubicacionAproximada).nombre,
          distancia: distanciaMetros(centro, c.ubicacionAproximada),
        }))
        .sort((a, b) => a.distancia - b.distancia);
      setResultados(cocheras);
      setBusqueda({ desde, hasta, centro });
      setSeleccionadaId(cocheras[0]?.id ?? null);
      setEstado('listo');
    } catch (err) {
      if (pedido !== ultimoPedido.current) return;
      setError(mensajeDeError(err));
      setEstado('error');
    }
  }, []);

  // Solo la primera búsqueda es automática; después busca la persona con «Buscá» o tocando el mapa.
  useEffect(() => {
    buscar(form, puntoPropio);
  }, []);

  const [conflicto, setConflicto] = useState(null);
  const volverABuscar = useCallback(
    (codigo, mensaje) => {
      setConflicto(`${codigo}: ${mensaje}. Actualizamos el tablero.`);
      buscar(form, puntoPropio);
    },
    [buscar, form, puntoPropio],
  );

  const cambiar = (cambios) => {
    setForm((f) => ({ ...f, ...cambios }));
    if (campoInvalido && campoInvalido in cambios) setCampoInvalido(null);
  };

  const elegirPunto = (punto) => {
    const nuevo = { ...form, lugar: PUNTO_PROPIO };
    setPuntoPropio(punto);
    setForm(nuevo);
    setConflicto(null);
    buscar(nuevo, punto);
  };

  const centro = busqueda?.centro ?? centroDe(form.lugar, puntoPropio);
  const seleccionada = resultados.find((c) => c.id === seleccionadaId);
  const conError = estado === 'error';
  const cantidad = estado === 'cargando' ? '··' : conError ? '--' : String(resultados.length).padStart(2, '0');

  return (
    <>
      {barra &&
        createPortal(
          <FormBusqueda
            form={form}
            puntoPropio={puntoPropio}
            invalido={campoInvalido}
            onCambiar={cambiar}
            onBuscar={() => {
              setConflicto(null);
              buscar(form, puntoPropio);
            }}
            buscando={estado === 'cargando'}
          />,
          barra,
        )}

      <div className="flex flex-1 flex-col lg:grid lg:h-[calc(100dvh-73px)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_540px] lg:grid-rows-[minmax(0,1fr)]">
        <section className="relative h-[45vh] min-h-[280px] lg:h-auto" aria-label="Mapa de cocheras">
          <Mapa
            centro={centro}
            radio={RADIO_METROS}
            cocheras={conError ? [] : resultados}
            seleccionadaId={seleccionadaId}
            onSeleccionar={setSeleccionadaId}
            onElegirPunto={elegirPunto}
          />
          <p className="pointer-events-none absolute bottom-6 left-3 z-[500] bg-paleta/90 px-3 py-1.5 text-sm text-tenue">
            Tocá el mapa para buscar en otro punto
          </p>
        </section>

        <section className="flex min-h-0 flex-col bg-paleta lg:border-l lg:border-[#1f2024]" aria-labelledby="tablero-titulo">
          <header className="border-b border-[#26282c] px-5 pt-5 pb-4 lg:px-6">
            <div className="flex items-center gap-3">
              <Celdas texto={cantidad} largo={2} tono={conError ? 'rojo' : 'ambar'} className="text-[2.25rem]" decorativo />
              <h1 id="tablero-titulo" className="font-celda text-[1.625rem] font-semibold tracking-[0.06em] uppercase">
                {conError ? (
                  'Revisá la búsqueda'
                ) : (
                  <>
                    <span className="sr-only">{estado === 'cargando' ? 'Buscando' : resultados.length} </span>
                    Cocheras libres
                  </>
                )}
              </h1>
            </div>
            {busqueda && !conError && (
              <p className="mt-2 text-tenue">
                <span className="text-letra">{etiquetaFranja(busqueda.desde, busqueda.hasta)}</span> · a menos de{' '}
                {formatoDistancia(RADIO_METROS)} de {busqueda.centro.nombre}
              </p>
            )}
          </header>

          {conflicto && (
            <p className="mx-5 mt-4 bg-rojo/10 px-4 py-3 lg:mx-6" role="alert">
              {conflicto}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={estado === 'cargando'}>
            {estado === 'error' && (
              <div id="busqueda-error" className="m-5 flex gap-3 bg-rojo/10 p-4 text-letra" role="alert">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-rojo" aria-hidden="true" />
                <div>
                  <p>{error}</p>
                  <button type="button" className="mt-2 font-semibold text-ambar underline" onClick={() => buscar(form, puntoPropio)}>
                    Reintentá
                  </button>
                </div>
              </div>
            )}

            {estado === 'listo' && resultados.length === 0 && (
              <div className="px-5 py-10 text-center lg:px-6">
                <Celdas texto="Sin lugar" tono="tenue" className="text-2xl" />
                <p className="mx-auto mt-4 max-w-sm text-tenue">
                  No hay cocheras libres en esa franja. Probá con otro horario o tocá el mapa para buscar más lejos.
                </p>
              </div>
            )}

            {resultados.length > 0 && estado !== 'error' && (
              <table className="w-full border-collapse text-left text-[1.0625rem]">
                <thead className="sticky top-0 z-10 bg-paleta">
                  <tr className="etiqueta">
                    <th scope="col" className="py-3 pr-2 pl-5 font-semibold lg:pl-6">Código</th>
                    <th scope="col" className="px-2 py-3 font-semibold">Cochera</th>
                    <th scope="col" className="py-3 pr-5 pl-2 text-right font-semibold sm:pr-2">Por hora</th>
                    <th scope="col" className="hidden px-2 py-3 text-right font-semibold sm:table-cell">Estado</th>
                  </tr>
                </thead>
                <tbody className={estado === 'cargando' ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                  {resultados.map((c, i) => {
                    const activa = c.id === seleccionadaId;
                    // Key por posición: la fila es un renglón fijo del tablero y, en una búsqueda
                    // nueva, sus celdas giran a los valores nuevos en lugar de remontarse.
                    return (
                      <tr
                        key={i}
                        onClick={() => setSeleccionadaId(c.id)}
                        aria-selected={activa}
                        className={`cursor-pointer border-t border-[#1d1e22] ${
                          activa ? 'bg-ambar/10 outline outline-1 -outline-offset-1 outline-ambar' : 'hover:bg-celda'
                        }`}
                      >
                        <td className="py-3 pr-2 pl-5 lg:pl-6">
                          <Celdas texto={c.codigo} largo={4} tono={activa ? 'ambar' : 'letra'} className="text-[1.375rem]" />
                        </td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            className="text-left leading-snug font-medium hover:text-ambar"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSeleccionadaId(c.id);
                            }}
                          >
                            {c.titulo}
                          </button>
                          <div className="text-[0.875rem] text-tenue">
                            {c.barrio} · {formatoDistancia(c.distancia)}
                          </div>
                        </td>
                        <td className="py-3 pr-5 pl-2 text-right sm:pr-2">
                          <Celdas texto={formatoPesos(c.precioHora)} largo={4} className="text-[1.375rem]" />
                        </td>
                        <td className="hidden py-3 pr-5 pl-2 text-right sm:table-cell lg:pr-6">
                          <Celdas texto="Libre" largo={5} className="text-[1.375rem]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {seleccionada && busqueda && estado === 'listo' && (
            <Detalle key={seleccionada.id} cochera={seleccionada} busqueda={busqueda} alConflicto={volverABuscar} />
          )}

          {usandoMocks && (
            <p className="border-t border-[#1d1e22] px-5 py-2 text-sm text-tenue lg:px-6">
              Datos de ejemplo mientras se integra el servicio de Cocheras.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
