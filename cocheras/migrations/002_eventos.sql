-- Idempotencia del consumidor: cada eventId se procesa una sola vez.
CREATE TABLE evento_procesado (
    event_id     UUID PRIMARY KEY,
    procesado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una cancelación puede llegar antes que la confirmación (los eventos no traen orden
-- garantizado). La fila revocada queda como marca y la confirmación tardía no la reabre.
ALTER TABLE acceso_direccion ADD COLUMN revocado BOOLEAN NOT NULL DEFAULT false;
