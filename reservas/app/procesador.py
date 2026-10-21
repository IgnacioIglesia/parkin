import logging
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import eventos, logs, metricas
from .repository import COLUMNAS

log = logging.getLogger("reservas.procesador")

# tipo de evento recibido -> (estado nuevo, evento que se publica, motivo)
TRANSICIONES = {
    "pago.aprobado": ("CONFIRMADA", "reserva.confirmada", None),
    "pago.rechazado": ("CANCELADA", "reserva.cancelada", "pago_rechazado"),
}


class EventoInvalido(Exception):
    pass


def _procesar(pool: ConnectionPool, evento: dict) -> str:
    """Aplica un evento de Pagos. Devuelve 'aplicado', 'duplicado' o 'ignorado'.

    Todo ocurre en una sola transacción: registrar el eventId, cambiar el estado, dejar el
    historial y encolar el evento de salida. Si algo falla, nada queda a medias y el
    reintento del broker vuelve a procesar el mensaje completo.
    """
    try:
        event_id = UUID(str(evento["eventId"]))
        tipo = evento["tipo"]
        reserva_id = UUID(str(evento["datos"]["reservaId"]))
    except (KeyError, ValueError, TypeError):
        raise EventoInvalido("Faltan eventId, tipo o datos.reservaId, o son inválidos")
    if tipo not in TRANSICIONES:
        raise EventoInvalido(f"Tipo de evento no soportado: {tipo}")

    estado_nuevo, routing_key, motivo = TRANSICIONES[tipo]
    trace_id = evento.get("traceId") or uuid4().hex

    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO evento_procesado (event_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (event_id,),
        )
        if cur.rowcount == 0:
            return "duplicado"

        # Un pago aprobado se confirma aunque haya pasado expira_en: el cobro ya se hizo y
        # la franja sigue retenida mientras la reserva esté PENDIENTE_PAGO.
        cur.execute(
            f"UPDATE reserva SET estado = %s, version = version + 1 "
            f"WHERE id = %s AND estado = 'PENDIENTE_PAGO' RETURNING {COLUMNAS}",
            (estado_nuevo, reserva_id),
        )
        reserva = cur.fetchone()
        if not reserva:
            log.warning("Evento %s (%s) ignorado: la reserva %s no está pendiente de pago",
                        event_id, tipo, reserva_id)
            return "ignorado"

        cur.execute(
            "INSERT INTO reserva_historial (reserva_id, estado_anterior, estado_nuevo) "
            "VALUES (%s, 'PENDIENTE_PAGO', %s)",
            (reserva_id, estado_nuevo),
        )
        eventos.encolar(conn, routing_key, reserva, trace_id, motivo)
    return "aplicado"


def procesar_evento(pool: ConnectionPool, evento: dict) -> str:
    """Procesa un evento de Pagos con el traceId y la reserva del evento en los logs."""
    tipo = evento.get("tipo") if isinstance(evento, dict) else None
    tipo = tipo if tipo in TRANSICIONES else "desconocido"
    datos = evento.get("datos") if isinstance(evento, dict) else None
    reserva_id = datos.get("reservaId") if isinstance(datos, dict) else None
    trace_id = evento.get("traceId") if isinstance(evento, dict) else None

    with logs.contexto(trace_id=trace_id, reserva_id=str(reserva_id) if reserva_id else None):
        try:
            resultado = _procesar(pool, evento)
        except EventoInvalido:
            metricas.EVENTOS_PROCESADOS.labels(tipo, "invalido").inc()
            raise
        metricas.EVENTOS_PROCESADOS.labels(tipo, resultado).inc()
        if resultado == "aplicado":
            if tipo == "pago.aprobado":
                metricas.RESERVAS_CONFIRMADAS.inc()
            else:
                metricas.RESERVAS_CANCELADAS.labels("pago_rechazado").inc()
        log.info("Evento %s: %s", tipo, resultado, extra={"evento": tipo, "resultado": resultado})
        return resultado
