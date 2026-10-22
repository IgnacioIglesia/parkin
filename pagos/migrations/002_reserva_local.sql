-- Copia local de la reserva, armada con los eventos de Reservas (database per service:
-- Pagos nunca consulta la base ni la API de Reservas para cobrar).
CREATE TABLE reserva (
  id             UUID PRIMARY KEY,
  cochera_id     UUID NOT NULL,
  conductor_id   UUID NOT NULL,
  propietario_id UUID NOT NULL,
  desde          TIMESTAMPTZ NOT NULL,
  hasta          TIMESTAMPTZ NOT NULL,
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  moneda         CHAR(3) NOT NULL,
  estado         TEXT NOT NULL,
  expira_en      TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pago ADD COLUMN checkout_url TEXT;
