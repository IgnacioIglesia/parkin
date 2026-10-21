CREATE TABLE pago (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id      UUID NOT NULL,
  usuario_id      UUID NOT NULL,
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  moneda          CHAR(3) NOT NULL DEFAULT 'UYU',
  estado          TEXT NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  id_externo      TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  motivo_rechazo  TEXT,
  version         INTEGER NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Como máximo un pago vivo (pendiente o aprobado) por reserva: evita cobrar dos veces
CREATE UNIQUE INDEX pago_un_activo_por_reserva
  ON pago (reserva_id)
  WHERE estado IN ('PENDIENTE', 'APROBADO');

CREATE INDEX pago_usuario_idx ON pago (usuario_id);

-- Idempotencia de consumidores RabbitMQ
CREATE TABLE evento_procesado (
  event_id     UUID PRIMARY KEY,
  tipo         TEXT NOT NULL,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox: el evento se guarda en la misma transacción que el cambio de estado
-- y un proceso aparte lo publica en RabbitMQ con publisher confirms
CREATE TABLE evento_saliente (
  event_id     UUID PRIMARY KEY,
  routing_key  TEXT NOT NULL,
  payload      JSONB NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_en TIMESTAMPTZ
);

CREATE INDEX evento_saliente_pendientes_idx
  ON evento_saliente (creado_en)
  WHERE publicado_en IS NULL;
