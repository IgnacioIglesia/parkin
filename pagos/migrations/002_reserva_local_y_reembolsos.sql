-- Copia local de las reservas, armada con los eventos reserva.* (Pagos no consulta a Reservas).
-- Todos los eventos traen la foto completa de la reserva, así que cualquiera sirve para crearla.
CREATE TABLE reserva_local (
  reserva_id     UUID PRIMARY KEY,
  cochera_id     UUID NOT NULL,
  conductor_id   UUID NOT NULL,
  propietario_id UUID NOT NULL,
  desde          TIMESTAMPTZ NOT NULL,
  hasta          TIMESTAMPTZ NOT NULL,
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  moneda         CHAR(3) NOT NULL DEFAULT 'UYU',
  estado         TEXT NOT NULL
                 CHECK (estado IN ('PENDIENTE_PAGO', 'CONFIRMADA', 'CANCELADA', 'EXPIRADA', 'FINALIZADA')),
  expira_en      TIMESTAMPTZ,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orden de los estados: un evento atrasado o repetido nunca hace retroceder la copia local.
CREATE FUNCTION rango_estado_reserva(estado TEXT) RETURNS INT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE estado
    WHEN 'PENDIENTE_PAGO' THEN 0
    WHEN 'CONFIRMADA'     THEN 1
    WHEN 'CANCELADA'      THEN 2
    WHEN 'EXPIRADA'       THEN 2
    WHEN 'FINALIZADA'     THEN 3
  END
$$;

-- URL de la pasarela para pagar, y reembolsos. Si se cobra algo que ya no corresponde
-- (reserva cancelada o vencida, o cancelación después de pagar) se devuelve la plata.
ALTER TABLE pago
  ADD COLUMN checkout_url        TEXT,
  ADD COLUMN reembolso_pendiente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN reembolso_id        TEXT,
  ADD COLUMN reembolsado_en      TIMESTAMPTZ;

CREATE INDEX pago_reembolso_pendiente_idx ON pago (actualizado_en) WHERE reembolso_pendiente;
