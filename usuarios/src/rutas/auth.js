import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { enTransaccion, pool } from '../db.js';
import { HttpError } from '../errores.js';
import { logins, refrescos, registros } from '../metricas.js';
import { requiereAuth } from '../middleware/auth.js';
import * as repo from '../repositorio.js';
import { firmarAccessToken, hashToken, nuevoRefreshToken } from '../tokens.js';

export const ROLES = ['PROPIETARIO', 'CONDUCTOR'];

const registroSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72), // 72 = límite de bcrypt
  nombre: z.string().trim().min(1).max(100),
  telefono: z.string().trim().max(30).optional(),
  roles: z.array(z.enum(ROLES)).min(1).default(['CONDUCTOR']),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

// Si el email no existe igual se compara contra un hash, así la respuesta tarda lo mismo
// y no se puede averiguar qué emails están registrados midiendo tiempos.
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', config.bcryptRounds);

async function emitirSesion(db, usuario) {
  const refreshToken = nuevoRefreshToken();
  await db.query(
    `INSERT INTO refresh_token (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, now() + make_interval(days => $3::int))`,
    [usuario.id, hashToken(refreshToken), config.refreshTtlDias],
  );
  return {
    accessToken: firmarAccessToken(usuario),
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTtlSeg,
    usuario: repo.publico(usuario),
  };
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const datos = registroSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(datos.password, config.bcryptRounds);
  const roles = [...new Set(datos.roles)];
  try {
    const sesion = await enTransaccion(async (db) => {
      const usuario = await repo.crear(db, { ...datos, roles, passwordHash });
      return emitirSesion(db, usuario);
    });
    registros.inc();
    req.log.info({ usuarioId: sesion.usuario.id }, 'usuario registrado');
    res.status(201).json(sesion);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'EMAIL_EN_USO', 'Ya existe un usuario con ese email');
    throw err;
  }
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const usuario = await repo.buscarPorEmail(pool, email);
  const coincide = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FALSO);
  if (!usuario || !coincide) {
    logins.labels('fallido').inc();
    req.log.warn('login fallido');
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos');
  }
  const sesion = await emitirSesion(pool, usuario);
  logins.labels('ok').inc();
  req.log.info({ usuarioId: usuario.id }, 'login correcto');
  res.json(sesion);
});

// Rotación: cada refresh token sirve una sola vez. Si llega uno ya usado,
// se asume robo y se revocan todas las sesiones del usuario. Excepción: un token rotado
// hace menos de REFRESH_TOKEN_GRACIA_SEG se acepta, porque el navegador puede no haber
// llegado a guardar el nuevo (recarga justo durante el refresh).
authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  const resultado = await enTransaccion(async (db) => {
    const { rows } = await db.query(
      `SELECT id, usuario_id, revocado, expira_en < now() AS vencido,
              rotado_en > now() - make_interval(secs => $2::int) AS en_gracia
       FROM refresh_token WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(refreshToken), config.refreshGraciaSeg],
    );
    const token = rows[0];
    if (!token || token.vencido) return { error: 'TOKEN_INVALIDO' };
    if (token.revocado && !token.en_gracia) {
      await db.query('UPDATE refresh_token SET revocado = true, rotado_en = NULL WHERE usuario_id = $1', [
        token.usuario_id,
      ]);
      return { error: 'TOKEN_REUTILIZADO', usuarioId: token.usuario_id };
    }
    if (!token.revocado) {
      await db.query('UPDATE refresh_token SET revocado = true, rotado_en = now() WHERE id = $1', [token.id]);
    }
    const usuario = await repo.buscarPorId(db, token.usuario_id);
    return { sesion: await emitirSesion(db, usuario), enGracia: token.revocado };
  });

  if (resultado.error === 'TOKEN_REUTILIZADO') {
    refrescos.labels('reutilizado').inc();
    req.log.warn({ usuarioId: resultado.usuarioId }, 'refresh token reutilizado: se revocan todas las sesiones');
  }
  if (resultado.error) {
    if (resultado.error === 'TOKEN_INVALIDO') refrescos.labels('invalido').inc();
    throw new HttpError(401, resultado.error, 'Refresh token inválido');
  }
  refrescos.labels(resultado.enGracia ? 'gracia' : 'ok').inc();
  res.json(resultado.sesion);
});


authRouter.post('/logout', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  await pool.query('UPDATE refresh_token SET revocado = true, rotado_en = NULL WHERE token_hash = $1', [
    hashToken(refreshToken),
  ]);
  res.status(204).end();
});

authRouter.post('/logout-todos', requiereAuth, async (req, res) => {
  // rotado_en = NULL también corta la ventana de gracia de los tokens recién rotados.
  await pool.query('UPDATE refresh_token SET revocado = true, rotado_en = NULL WHERE usuario_id = $1', [req.usuario.id]);
  req.log.info({ usuarioId: req.usuario.id }, 'sesiones cerradas en todos los dispositivos');
  res.status(204).end();
});
