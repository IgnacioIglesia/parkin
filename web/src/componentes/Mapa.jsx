import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { formatoPesos } from '../utilidades/formato.js';

// Teselas estándar de OpenStreetMap (sin API key); el CSS las oscurece para el tablero.
const TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Cada búsqueda nueva encuadra el punto buscado y sus resultados; elegir una cochera
// solo mueve el mapa si su pin quedó fuera de la vista.
function Seguir({ centro, cocheras, foco }) {
  const mapa = useMap();
  const firmaAnterior = useRef(null);
  // La firma resume centro y resultados: cambia solo cuando hay una búsqueda nueva.
  const firma = `${centro.lat},${centro.lng}|${cocheras.map((c) => c.id).join(',')}`;

  // Un solo efecto: si en el mismo render cambian la búsqueda y la selección,
  // un panTo de la selección cancelaría el encuadre en curso.
  useEffect(() => {
    if (firma !== firmaAnterior.current) {
      firmaAnterior.current = firma;
      const puntos = [
        [centro.lat, centro.lng],
        ...cocheras.map((c) => [c.ubicacionAproximada.lat, c.ubicacionAproximada.lng]),
      ];
      const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (puntos.length === 1) {
        if (quieto) mapa.setView(puntos[0], 15, { animate: false });
        else mapa.flyTo(puntos[0], 15, { duration: 0.6 });
      } else {
        const limites = L.latLngBounds(puntos);
        const opciones = { padding: [70, 70], maxZoom: 16 };
        if (quieto) mapa.fitBounds(limites, { ...opciones, animate: false });
        else mapa.flyToBounds(limites, { ...opciones, duration: 0.6 });
      }
    } else if (foco && !mapa.getBounds().contains([foco.lat, foco.lng])) {
      mapa.panTo([foco.lat, foco.lng], {
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    }
  }, [mapa, firma, foco?.lat, foco?.lng]);
  return null;
}

function AlTocar({ onTocar }) {
  useMapEvents({ click: (e) => onTocar({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

const placa = (texto, seleccionada) =>
  L.divIcon({
    className: '',
    html: `<span class="placa${seleccionada ? ' placa-sel' : ''}">${texto}</span>`,
    iconSize: [0, 0],
  });

export function Mapa({ centro, radio, cocheras, seleccionadaId, onSeleccionar, onElegirPunto }) {
  const seleccionada = cocheras.find((c) => c.id === seleccionadaId);

  return (
    <MapContainer center={[centro.lat, centro.lng]} zoom={15} className="h-full w-full" scrollWheelZoom>
      <TileLayer url={TESELAS} attribution={ATRIBUCION} maxZoom={19} />
      <Circle
        center={[centro.lat, centro.lng]}
        radius={radio}
        pathOptions={{ color: '#ffb000', weight: 1, opacity: 0.45, dashArray: '4 6', fillOpacity: 0.03 }}
        interactive={false}
      />
      <CircleMarker
        center={[centro.lat, centro.lng]}
        radius={7}
        pathOptions={{ color: '#0b0b0d', weight: 3, fillColor: '#ffb000', fillOpacity: 1 }}
        interactive={false}
      />
      {cocheras.map((c) => {
        const activa = c.id === seleccionadaId;
        return (
          <Marker
            key={c.id}
            position={[c.ubicacionAproximada.lat, c.ubicacionAproximada.lng]}
            icon={placa(`${c.codigo} · ${formatoPesos(c.precioHora)}`, activa)}
            zIndexOffset={activa ? 1000 : 0}
            title={`${c.codigo}: ${c.titulo}, ${formatoPesos(c.precioHora)} por hora`}
            alt={`${c.codigo}: ${c.titulo}`}
            eventHandlers={{ click: () => onSeleccionar(c.id) }}
          />
        );
      })}
      <Seguir centro={centro} cocheras={cocheras} foco={seleccionada?.ubicacionAproximada} />
      <AlTocar onTocar={onElegirPunto} />
    </MapContainer>
  );
}
