-- Esquema inicial de db_usuarios (sección 8.1 de la segunda entrega).

CREATE TABLE usuario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,          -- se guarda siempre en minúsculas
  password_hash   TEXT NOT NULL,                 -- bcrypt, nunca la contraseña
  nombre          TEXT NOT NULL,
  telefono        TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un usuario puede tener los dos roles.
CREATE TABLE usuario_rol (
  usuario_id  UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  rol         TEXT NOT NULL CHECK (rol IN ('PROPIETARIO', 'CONDUCTOR')),
  PRIMARY KEY (usuario_id, rol)
);

-- Se guarda solo el hash del refresh token; revocado permite cerrar sesión en todos los dispositivos.
CREATE TABLE refresh_token (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expira_en   TIMESTAMPTZ NOT NULL,
  revocado    BOOLEAN NOT NULL DEFAULT false,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_token_usuario_idx ON refresh_token (usuario_id);
