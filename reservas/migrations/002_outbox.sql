-- Outbox transaccional: el evento se guarda en la misma transacción que el cambio de
-- estado y un publicador lo envía a RabbitMQ después. Así nunca se pierde un evento
-- ni se publica uno de una transacción que terminó en rollback.
CREATE TABLE outbox (
    id           BIGSERIAL PRIMARY KEY,
    routing_key  TEXT NOT NULL,
    payload      JSONB NOT NULL,
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    publicada_en TIMESTAMPTZ
);

CREATE INDEX outbox_pendientes_idx ON outbox (id) WHERE publicada_en IS NULL;
