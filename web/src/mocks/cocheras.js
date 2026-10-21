// Datos SINTÉTICOS para la demo mientras el servicio de Cocheras no está integrado.
// No son cocheras ni precios reales. Respetan la forma del tipo Cochera del contrato GraphQL.
import { distanciaMetros, entraEn } from '../utilidades/formato.js';

const COCHERAS = [
  { id: '7f1c2a90-0001', titulo: 'Garaje en edificio, techado', precioHora: 90, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9098, lng: -56.1482 } },
  { id: '7f1c2a90-0002', titulo: 'Cochera en casa, portón eléctrico', precioHora: 75, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9131, lng: -56.1537 } },
  { id: '7f1c2a90-0003', titulo: 'Subsuelo con vigilancia', precioHora: 110, tipoVehiculo: 'CAMIONETA', ubicacionAproximada: { lat: -34.9076, lng: -56.1531 } },
  { id: '7f1c2a90-0004', titulo: 'Garaje al frente, sobre Benito Blanco', precioHora: 80, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9142, lng: -56.1468 } },
  { id: '7f1c2a90-0005', titulo: 'Cochera amplia en PH', precioHora: 95, tipoVehiculo: 'CAMIONETA', ubicacionAproximada: { lat: -34.9172, lng: -56.1556 } },
  { id: '7f1c2a90-0006', titulo: 'Garaje cerca del shopping', precioHora: 120, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9221, lng: -56.1601 } },
  { id: '7f1c2a90-0007', titulo: 'Cochera en edificio frente a la Rambla', precioHora: 130, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9255, lng: -56.1572 } },
  { id: '7f1c2a90-0008', titulo: 'Cochera techada junto al parque', precioHora: 85, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9126, lng: -56.1648 } },
  { id: '7f1c2a90-0009', titulo: 'Garaje en casona', precioHora: 70, tipoVehiculo: 'CAMIONETA', ubicacionAproximada: { lat: -34.9152, lng: -56.1702 } },
  { id: '7f1c2a90-0010', titulo: 'Cochera cerca de la Universidad', precioHora: 85, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9002, lng: -56.1748 } },
  { id: '7f1c2a90-0011', titulo: 'Subsuelo con ascensor', precioHora: 100, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9061, lng: -56.1889 } },
  { id: '7f1c2a90-0012', titulo: 'Garaje a media cuadra de 18 de Julio', precioHora: 95, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9049, lng: -56.1924 } },
  { id: '7f1c2a90-0013', titulo: 'Cochera en edificio del puerto', precioHora: 105, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9073, lng: -56.2061 } },
  { id: '7f1c2a90-0014', titulo: 'Cochera junto a la terminal', precioHora: 90, tipoVehiculo: 'CAMIONETA', ubicacionAproximada: { lat: -34.8951, lng: -56.1648 } },
  { id: '7f1c2a90-0015', titulo: 'Garaje con portón, frente a la playa', precioHora: 115, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.9041, lng: -56.1352 } },
  { id: '7f1c2a90-0016', titulo: 'Cochera en casa con jardín', precioHora: 65, tipoVehiculo: 'AUTO', ubicacionAproximada: { lat: -34.8918, lng: -56.1071 } },
  { id: '7f1c2a90-0018', titulo: 'Lugar para moto en garaje de edificio', precioHora: 35, tipoVehiculo: 'MOTO', ubicacionAproximada: { lat: -34.9104, lng: -56.1521 } },
  { id: '7f1c2a90-0019', titulo: 'Espacio para moto junto al portón', precioHora: 30, tipoVehiculo: 'MOTO', ubicacionAproximada: { lat: -34.9059, lng: -56.1872 } },
  { id: '7f1c2a90-0017', titulo: 'Garaje doble, una plaza libre', precioHora: 140, tipoVehiculo: 'CAMIONETA', ubicacionAproximada: { lat: -34.8868, lng: -56.0571 } },
];

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function buscarCocherasMock({ cerca, radioMetros, desde, tipo }) {
  await esperar(350);
  // Ocupación simulada: según el día y la hora pedidos, algunas cocheras no están libres.
  const inicio = new Date(desde);
  const semilla = inicio.getDate() + inicio.getHours();
  return COCHERAS.filter((c, i) => {
    if ((i + semilla) % 5 === 0) return false;
    if (tipo && !entraEn(tipo, c.tipoVehiculo)) return false;
    return distanciaMetros(cerca, c.ubicacionAproximada) <= radioMetros;
  }).map((c) => ({ ...c, __typename: 'Cochera' }));
}
