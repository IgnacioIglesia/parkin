import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { clavePublica, tokenDe, EMISOR, randomUUID } from './ayuda.js';
import { firmar, firmaValida } from '../src/firma.js';
import { crearVerificador } from '../src/auth.js';

test('la firma HMAC válida se acepta', () => {
  const cuerpo = Buffer.from('{"a":1}');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, 's3creto'), 's3creto'), true);
});

test('una firma de otro secreto, adulterada, vacía o mal formada se rechaza', () => {
  const cuerpo = Buffer.from('{"a":1}');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, 'otro'), 's3creto'), false);
  assert.equal(firmaValida(Buffer.from('{"a":2}'), firmar(cuerpo, 's3creto'), 's3creto'), false);
  assert.equal(firmaValida(cuerpo, '', 's3creto'), false);
  assert.equal(firmaValida(cuerpo, undefined, 's3creto'), false);
  assert.equal(firmaValida(cuerpo, 'zz-no-es-hex', 's3creto'), false);
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, 's3creto').slice(0, 10), 's3creto'), false);
});

test('sin secreto configurado no se acepta ninguna firma', () => {
  const cuerpo = Buffer.from('x');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, ''), ''), false);
});

test('el verificador devuelve el usuario y sus roles', () => {
  const verificar = crearVerificador({ clavePublica, emisor: EMISOR });
  const id = randomUUID();
  assert.deepEqual(verificar(tokenDe(id, { roles: ['PROPIETARIO'] })), { id, roles: ['PROPIETARIO'] });
});

test('el verificador rechaza vencidos, de otro emisor, de otra clave y con otro algoritmo', () => {
  const verificar = crearVerificador({ clavePublica, emisor: EMISOR });
  const id = randomUUID();
  const otra = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const rechazados = [
    tokenDe(id, { expiresIn: -10 }),
    tokenDe(id, { issuer: 'otro' }),
    jwt.sign({}, otra, { algorithm: 'RS256', subject: id, issuer: EMISOR }),
    jwt.sign({}, clavePublica, { algorithm: 'HS256', subject: id, issuer: EMISOR }), // confusión de algoritmo
    'abc.def.ghi',
  ];
  for (const token of rechazados) {
    assert.throws(() => verificar(token), (err) => err.codigo === 'TOKEN_INVALIDO');
  }
});
