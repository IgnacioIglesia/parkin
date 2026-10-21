import logging
import threading
import uuid

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import eventos, metricas
from .repository import COLUMNAS

log = logging.getLogger("reservas.expiracion")

LOTE = 100


def expirar_vencidas(pool: ConnectionPool) -> int:
    """Pasa a EXPIRADA las reservas PENDIENTE_PAGO cuya retención venció y publica
    `reserva.expirada`. Devuelve cuántas expiró.

    Es seguro correrlo en varias réplicas a la vez: `SKIP LOCKED` hace que cada una tome
    reservas distintas. Si justo llega un `pago.aprobado` para la misma reserva, el bloqueo
    de fila decide quién va primero: o se confirma o expira, nunca las dos.
    """
    total = 0
    while True:
        expiradas = _expirar_lote(pool)
        total += expiradas
        if expiradas < LOTE:
            return total


def _expirar_lote(pool: ConnectionPool) -> int:
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"UPDATE reserva SET estado = 'EXPIRADA', version = version + 1 "
            f"WHERE id IN ("
            f"  SELECT id FROM reserva WHERE estado = 'PENDIENTE_PAGO' AND expira_en <= now() "
            f"  ORDER BY expira_en LIMIT %s FOR UPDATE SKIP LOCKED"
            f") RETURNING {COLUMNAS}",
            (LOTE,),
        )
        reservas = cur.fetchall()
        for reserva in reservas:
            cur.execute(
                "INSERT INTO reserva_historial (reserva_id, estado_anterior, estado_nuevo) "
                "VALUES (%s, 'PENDIENTE_PAGO', 'EXPIRADA')",
                (reserva["id"],),
            )
            eventos.encolar(conn, "reserva.expirada", reserva, uuid.uuid4().hex, motivo="plazo_vencido")
    metricas.RESERVAS_EXPIRADAS.inc(len(reservas))
    return len(reservas)


class Expirador(threading.Thread):
    """Corre `expirar_vencidas` cada `intervalo` segundos (por defecto, cada minuto)."""

    def __init__(self, pool: ConnectionPool, intervalo: float):
        super().__init__(name="expirador", daemon=True)
        self.pool, self.intervalo = pool, intervalo
        self._detener = threading.Event()

    def run(self):
        while not self._detener.is_set():
            try:
                expiradas = expirar_vencidas(self.pool)
                if expiradas:
                    log.info("Reservas expiradas: %s", expiradas)
            except Exception:
                log.exception("Falló la expiración de reservas; se reintenta en el próximo ciclo")
            self._detener.wait(self.intervalo)

    def detener(self):
        self._detener.set()
