// Acceso a datos de usuarios. Cada función recibe `db` (pool o cliente de una transacción).

const SELECT_USUARIO = `
  SELECT u.id, u.email, u.password_hash, u.nombre, u.telefono, u.creado_en,
         COALESCE(array_agg(r.rol ORDER BY r.rol) FILTER (WHERE r.rol IS NOT NULL), '{}') AS roles
  FROM usuario u
  LEFT JOIN usuario_rol r ON r.usuario_id = u.id`;

export async function buscarPorEmail(db, email) {
  const { rows } = await db.query(`${SELECT_USUARIO} WHERE u.email = $1 GROUP BY u.id`, [email]);
  return rows[0] ?? null;
}

export async function buscarPorId(db, id) {
  const { rows } = await db.query(`${SELECT_USUARIO} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ?? null;
}

export async function crear(db, { email, passwordHash, nombre, telefono, roles }) {
  const { rows } = await db.query(
    'INSERT INTO usuario (email, password_hash, nombre, telefono) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, passwordHash, nombre, telefono ?? null],
  );
  const id = rows[0].id;
  await db.query('INSERT INTO usuario_rol (usuario_id, rol) SELECT $1, unnest($2::text[])', [id, roles]);
  return buscarPorId(db, id);
}

// `cambios` ya viene validado por zod con .strict(), así que sus claves son solo nombre/telefono.
export async function actualizarContacto(db, id, cambios) {
  const campos = Object.keys(cambios);
  const sets = campos.map((campo, i) => `${campo} = $${i + 2}`);
  await db.query(
    `UPDATE usuario SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $1`,
    [id, ...campos.map((c) => cambios[c])],
  );
  return buscarPorId(db, id);
}

export async function agregarRol(db, id, rol) {
  await db.query('INSERT INTO usuario_rol (usuario_id, rol) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, rol]);
  return buscarPorId(db, id);
}

export function publico(usuario) {
  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    telefono: usuario.telefono,
    roles: usuario.roles,
    creadoEn: usuario.creado_en,
  };
}
