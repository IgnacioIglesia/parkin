import DataLoader from 'dataloader';
import * as repo from '../repositorio.js';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// El gateway valida el JWT y reenvía la identidad en estos headers (y descarta los que
// mande el cliente). Sin X-User-Id válido, la request es anónima.
function usuarioDe(req) {
  const id = req.headers['x-user-id'];
  if (!id || !UUID.test(id)) return null;
  const roles = (req.headers['x-user-roles'] ?? '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
  return { id: id.toLowerCase(), roles };
}

// Un contexto por request: los DataLoader agrupan las consultas de todas las cocheras
// de la respuesta en una sola (evitan N+1) y su caché no se comparte entre requests.
export function crearContexto({ req, pool, reservas, cache }) {
  const usuario = usuarioDe(req);
  return {
    usuario,
    pool,
    reservas,
    cache,
    log: req.log,
    traceparent: req.headers.traceparent,
    franjas: new DataLoader(async (ids) => {
      const porCochera = await repo.franjasDe(pool, [...ids]);
      return ids.map((id) => porCochera.get(id));
    }),
    accesoDireccion: new DataLoader(async (ids) => {
      if (!usuario) return ids.map(() => false);
      const conAcceso = await repo.cocherasConAcceso(pool, usuario.id, [...ids]);
      return ids.map((id) => conAcceso.has(id));
    }),
  };
}
