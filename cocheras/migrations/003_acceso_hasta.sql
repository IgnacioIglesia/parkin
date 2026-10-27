-- La dirección exacta se ve solo mientras la reserva no terminó: `hasta` es el fin de la
-- franja reservada (viene en el evento). Las filas anteriores a esta migración no lo tienen
-- y siguen visibles como antes.
ALTER TABLE acceso_direccion ADD COLUMN hasta TIMESTAMPTZ;
