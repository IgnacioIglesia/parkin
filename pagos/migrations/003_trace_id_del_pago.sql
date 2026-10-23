-- traceId de la request que inició el pago. El aviso de la pasarela llega mucho después y sin
-- traceparent: al procesarlo se usa este traceId, así pago.aprobado / pago.rechazado (y lo que
-- hacen Reservas y Cocheras con ellos) quedan en la misma traza que el "Pagar" del conductor.
ALTER TABLE pago ADD COLUMN trace_id TEXT;
