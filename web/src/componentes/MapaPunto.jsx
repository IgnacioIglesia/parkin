import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

const TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function Centrar({ punto }) {
  const mapa = useMap();
  useEffect(() => {
    if (punto) mapa.setView([punto.lat, punto.lng], mapa.getZoom(), { animate: false });
  }, [mapa, punto?.lat, punto?.lng]);
  return null;
}

function AlTocar({ onElegir }) {
  useMapEvents({ click: (e) => onElegir({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// Un solo lugar en el mapa. Con `aproximado`, un círculo en vez de un punto: la ubicación
// publicada está corrida entre 100 y 300 m de la real. Con `onElegir`, tocar el mapa elige el punto.
export function MapaPunto({ centro, punto, aproximado = false, onElegir, className = 'h-72' }) {
  const vista = punto ?? centro;
  return (
    <div className={`overflow-hidden border border-[#1f2024] ${className}`}>
      <MapContainer center={[vista.lat, vista.lng]} zoom={16} className="h-full w-full" scrollWheelZoom={Boolean(onElegir)}>
        <TileLayer url={TESELAS} attribution={ATRIBUCION} maxZoom={19} />
        {punto && aproximado && (
          <Circle
            center={[punto.lat, punto.lng]}
            radius={300}
            pathOptions={{ color: '#ffb000', weight: 1, dashArray: '4 6', fillColor: '#ffb000', fillOpacity: 0.08 }}
            interactive={false}
          />
        )}
        {punto && !aproximado && (
          <CircleMarker
            center={[punto.lat, punto.lng]}
            radius={9}
            pathOptions={{ color: '#0b0b0d', weight: 3, fillColor: '#ffb000', fillOpacity: 1 }}
            interactive={false}
          />
        )}
        <Centrar punto={punto} />
        {onElegir && <AlTocar onElegir={onElegir} />}
      </MapContainer>
    </div>
  );
}
