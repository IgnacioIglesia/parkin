CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reserva (
    id              UUID PRIMARY KEY,
    cochera_id      UUID NOT NULL,
    conductor_id    UUID NOT NULL,
    propietario_id  UUID NOT NULL,
    franja          TSTZRANGE NOT NULL,
    estado          TEXT NOT NULL
                    CHECK (estado IN ('PENDIENTE_PAGO', 'CONFIRMADA', 'CANCELADA', 'EXPIRADA', 'FINALIZADA')),
    monto           NUMERIC(10,2) NOT NULL CHECK (monto >= 0),
    expira_en       TIMESTAMPTZ,
    idempotency_key TEXT UNIQUE NOT NULL,
    version         INT NOT NULL DEFAULT 1,
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT isempty(franja)),
    -- Una cochera no puede tener dos reservas activas con franjas solapadas.
    -- Las canceladas, expiradas y finalizadas quedan fuera y liberan la franja.
    EXCLUDE USING gist (cochera_id WITH =, franja WITH &&)
        WHERE (estado IN ('PENDIENTE_PAGO', 'CONFIRMADA'))
);

CREATE INDEX reserva_conductor_idx ON reserva (conductor_id);
CREATE INDEX reserva_propietario_idx ON reserva (propietario_id);
CREATE INDEX reserva_expiracion_idx ON reserva (expira_en) WHERE estado = 'PENDIENTE_PAGO';

CREATE TABLE reserva_historial (
    id              BIGSERIAL PRIMARY KEY,
    reserva_id      UUID NOT NULL REFERENCES reserva (id),
    estado_anterior TEXT,
    estado_nuevo    TEXT NOT NULL,
    ocurrido_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evento_procesado (
    event_id     UUID PRIMARY KEY,
    procesado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
