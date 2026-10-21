import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError } from '../errores.js';
import { requiereAuth } from '../middleware/auth.js';
import * as repo from '../repositorio.js';
import { firmarAccessToken } from '../tokens.js';
import { ROLES } from './auth.js';

const contactoSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100).optional(),
    telefono: z.string().trim().max(30).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Enviar al menos un campo' });

const rolSchema = z.object({ rol: z.enum(ROLES) });
const idSchema = z.object({ id: z.string().uuid() });

function existe(usuario) {
  if (!usuario) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
  return usuario;
}

export const usuariosRouter = Router();
usuariosRouter.use(requiereAuth);

usuariosRouter.get('/me', async (req, res) => {
  const usuario = existe(await repo.buscarPorId(pool, req.usuario.id));
  res.json(repo.publico(usuario));
});

usuariosRouter.patch('/me', async (req, res) => {
  const cambios = contactoSchema.parse(req.body);
  const usuario = existe(await repo.actualizarContacto(pool, req.usuario.id, cambios));
  res.json(repo.publico(usuario));
});

// Un conductor que pasa a publicar cocheras (o al revés). Los roles van en el JWT,
// así que se devuelve un access token nuevo.
usuariosRouter.post('/me/roles', async (req, res) => {
  const { rol } = rolSchema.parse(req.body);
  const usuario = existe(await repo.agregarRol(pool, req.usuario.id, rol));
  req.log.info({ usuarioId: usuario.id, rol }, 'rol agregado');
  res.json({ usuario: repo.publico(usuario), accessToken: firmarAccessToken(usuario) });
});

// Perfil público mínimo, para que otros servicios o el front muestren el nombre del propietario.
usuariosRouter.get('/:id', async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const usuario = existe(await repo.buscarPorId(pool, id));
  res.json({ id: usuario.id, nombre: usuario.nombre });
});
