// Barrios de Montevideo que ofrece el buscador, con un punto central aproximado.
export const BARRIOS = [
  { nombre: 'Pocitos', sigla: 'PO', lat: -34.911, lng: -56.1505 },
  { nombre: 'Punta Carretas', sigla: 'PC', lat: -34.9235, lng: -56.1585 },
  { nombre: 'Parque Rodó', sigla: 'PR', lat: -34.9135, lng: -56.167 },
  { nombre: 'Cordón', sigla: 'CO', lat: -34.8995, lng: -56.1755 },
  { nombre: 'Centro', sigla: 'CE', lat: -34.9058, lng: -56.19 },
  { nombre: 'Ciudad Vieja', sigla: 'CV', lat: -34.9068, lng: -56.2075 },
  { nombre: 'Tres Cruces', sigla: 'TC', lat: -34.8945, lng: -56.166 },
  { nombre: 'Buceo', sigla: 'BU', lat: -34.9035, lng: -56.134 },
  { nombre: 'Malvín', sigla: 'MA', lat: -34.8925, lng: -56.106 },
  { nombre: 'Carrasco', sigla: 'CA', lat: -34.886, lng: -56.056 },
];

// Del contrato: tamaño máximo que admite la cochera, MOTO < AUTO < CAMIONETA.
export const TIPOS_VEHICULO = [
  { valor: 'MOTO', nombre: 'Moto' },
  { valor: 'AUTO', nombre: 'Auto' },
  { valor: 'CAMIONETA', nombre: 'Camioneta' },
];

export const entraEn = (vehiculo, cochera) =>
  TIPOS_VEHICULO.findIndex((t) => t.valor === vehiculo) <= TIPOS_VEHICULO.findIndex((t) => t.valor === cochera);

export function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function barrioMasCercano(punto) {
  return BARRIOS.reduce((mejor, b) => (distanciaMetros(punto, b) < distanciaMetros(punto, mejor) ? b : mejor));
}

// Código corto para el tablero (PO14): sigla del barrio + dos dígitos estables derivados del id.
export function codigoCochera(cochera) {
  let hash = 2166136261; // FNV-1a: ids parecidos dan códigos bien distintos
  for (const c of cochera.id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return `${barrioMasCercano(cochera.ubicacionAproximada).sigla}${(hash % 90) + 10}`;
}

export function formatoDistancia(metros) {
  if (metros < 1000) return `${Math.max(50, Math.round(metros / 50) * 50)} m`;
  return `${(metros / 1000).toLocaleString('es-UY', { maximumFractionDigits: 1 })} km`;
}

export const formatoPesos = (monto) => `$${Math.round(monto).toLocaleString('es-UY')}`;

export const horasEntre = (desde, hasta) => (new Date(hasta) - new Date(desde)) / 36e5;

export function formatoHoras(horas) {
  return `${horas.toLocaleString('es-UY', { maximumFractionDigits: 1 })} h`;
}

const hora = (d) => d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false });
const dia = (d) => `${d.toLocaleDateString('es-UY', { weekday: 'short' }).replace('.', '')} ${d.getDate()}`;

// "mar 27 · 09:00–13:00", o con los dos días si la franja cruza la medianoche.
export function etiquetaFranja(desde, hasta) {
  const d = new Date(desde);
  const h = new Date(hasta);
  if (d.toDateString() === h.toDateString()) return `${dia(d)} · ${hora(d)}–${hora(h)}`;
  return `${dia(d)} ${hora(d)} – ${dia(h)} ${hora(h)}`;
}

// Date → "YYYY-MM-DDTHH:mm" en hora local, el formato de <input type="datetime-local">.
export function aInputLocal(fecha) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}T${p(fecha.getHours())}:${p(fecha.getMinutes())}`;
}

// Tono de cada estado de reserva en el tablero.
export const TONO_ESTADO = {
  LIBRE: 'letra',
  RETENIDA: 'ambar',
  PENDIENTE_PAGO: 'ambar',
  CONFIRMADA: 'verde',
  CANCELADA: 'rojo',
  EXPIRADA: 'rojo',
  FINALIZADA: 'tenue',
};
