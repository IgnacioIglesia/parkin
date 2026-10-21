from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from psycopg import errors
from psycopg.rows import dict_row
from psycopg.types.range import Range
from psycopg_pool import ConnectionPool

from . import eventos, metricas

COLUMNAS = (
    "id, cochera_id, conductor_id, propietario_id, lower(franja) AS desde, "
    "upper(franja) AS hasta, estado, monto::float8 AS monto, expira_en, creada_en, version"
)


class FranjaOcupada(Exception):
    pass


class ClaveDeOtroUsuario(Exception):
    pass


def crear_reserva(
    pool: ConnectionPool,
    *,
    conductor_id: UUID,
    cochera_id: UUID,
    propietario_id: UUID,
    desde: datetime,
    hasta: datetime,
    monto: Decimal,
    idempotency_key: str,
    retencion_minutos: int,
    trace_id: str,
) -> tuple[dict, bool]:
    """Devuelve (reserva, creada). creada=False si la Idempotency-Key ya existía."""
    existente = reserva_por_clave(pool, idempotency_key, conductor_id)
    if existente:
        return existente, False

    reserva_id = uuid4()
    expira_en = datetime.now(timezone.utc) + timedelta(minutes=retencion_minutos)
    try:
        with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                f"INSERT INTO reserva (id, cochera_id, conductor_id, propietario_id, franja, "
                f"estado, monto, expira_en, idempotency_key) "
                f"VALUES (%s, %s, %s, %s, %s, 'PENDIENTE_PAGO', %s, %s, %s) "
                f"RETURNING {COLUMNAS}",
                (reserva_id, cochera_id, conductor_id, propietario_id,
                 Range(desde, hasta, "[)"), monto, expira_en, idempotency_key),
            )
            reserva = cur.fetchone()
            cur.execute(
                "INSERT INTO reserva_historial (reserva_id, estado_anterior, estado_nuevo) "
                "VALUES (%s, NULL, 'PENDIENTE_PAGO')",
                (reserva_id,),
            )
            eventos.encolar(conn, "reserva.creada", reserva, trace_id)
        metricas.RESERVAS_CREADAS.inc()
        return reserva, True
    except errors.ExclusionViolation:
        metricas.CONFLICTOS.inc()
        raise FranjaOcupada()
    except errors.UniqueViolation:
        # Dos requests con la misma clave llegaron a la vez: gana el primero.
        existente = reserva_por_clave(pool, idempotency_key, conductor_id)
        if existente:
            return existente, False
        raise


def reserva_por_clave(pool: ConnectionPool, clave: str, conductor_id: UUID) -> dict | None:
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT {COLUMNAS} FROM reserva WHERE idempotency_key = %s", (clave,))
        fila = cur.fetchone()
    if fila and fila["conductor_id"] != conductor_id:
        raise ClaveDeOtroUsuario()
    return fila


class NoEncontrada(Exception):
    pass


class NoSePuedeCancelar(Exception):
    pass


def obtener_reserva(pool: ConnectionPool, reserva_id: UUID, usuario_id: UUID) -> dict:
    """Solo la ve el conductor o el propietario; para el resto es como si no existiera."""
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT {COLUMNAS} FROM reserva WHERE id = %s", (reserva_id,))
        fila = cur.fetchone()
    if not fila or usuario_id not in (fila["conductor_id"], fila["propietario_id"]):
        raise NoEncontrada()
    return fila


def listar_reservas(pool: ConnectionPool, usuario_id: UUID, rol: str) -> list[dict]:
    columna = "conductor_id" if rol == "conductor" else "propietario_id"
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT {COLUMNAS} FROM reserva WHERE {columna} = %s ORDER BY lower(franja) DESC",
            (usuario_id,),
        )
        return cur.fetchall()


def cancelar_reserva(pool: ConnectionPool, reserva_id: UUID, usuario_id: UUID, trace_id: str) -> dict:
    # Provisorio: la política de cancelación (plazos y reembolsos) no está definida todavía.
    # Por ahora se puede cancelar mientras la reserva esté activa y no haya comenzado.
    reserva = obtener_reserva(pool, reserva_id, usuario_id)
    if reserva["estado"] not in ("PENDIENTE_PAGO", "CONFIRMADA"):
        raise NoSePuedeCancelar("La reserva ya no está activa")
    if reserva["desde"] <= datetime.now(timezone.utc):
        raise NoSePuedeCancelar("La reserva ya comenzó")

    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        # Control optimista: si otra operación cambió la reserva entre la lectura y
        # este UPDATE, la versión no coincide y no se modifica nada.
        cur.execute(
            f"UPDATE reserva SET estado = 'CANCELADA', version = version + 1 "
            f"WHERE id = %s AND version = %s AND estado IN ('PENDIENTE_PAGO', 'CONFIRMADA') "
            f"RETURNING {COLUMNAS}",
            (reserva_id, reserva["version"]),
        )
        actualizada = cur.fetchone()
        if not actualizada:
            raise NoSePuedeCancelar("La reserva cambió mientras se procesaba, reintentá")
        cur.execute(
            "INSERT INTO reserva_historial (reserva_id, estado_anterior, estado_nuevo) "
            "VALUES (%s, %s, 'CANCELADA')",
            (reserva_id, reserva["estado"]),
        )
        eventos.encolar(conn, "reserva.cancelada", actualizada, trace_id, motivo="cancelada_por_usuario")
    metricas.RESERVAS_CANCELADAS.labels("cancelada_por_usuario").inc()
    return actualizada


def ocupacion(pool: ConnectionPool, cochera_id: UUID, desde: datetime, hasta: datetime) -> list[dict]:
    """Franjas ocupadas dentro de [desde, hasta). No expone datos de las personas."""
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT lower(franja) AS desde, upper(franja) AS hasta, estado FROM reserva "
            "WHERE cochera_id = %s AND estado IN ('PENDIENTE_PAGO', 'CONFIRMADA') "
            "AND franja && %s ORDER BY lower(franja)",
            (cochera_id, Range(desde, hasta, "[)")),
        )
        return cur.fetchall()
