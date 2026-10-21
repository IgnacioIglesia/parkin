from typing import Callable

from psycopg_pool import ConnectionPool


def drenar(pool: ConnectionPool, publicar: Callable[[str, dict], None], limite: int = 100) -> int:
    """Publica los eventos pendientes del outbox, de a uno, en orden de creación.

    `publicar(routing_key, evento)` debe lanzar una excepción si el broker no confirma.
    En ese caso la transacción se revierte y el evento queda pendiente para el próximo
    intento (entrega at-least-once; los consumidores son idempotentes). `SKIP LOCKED`
    permite que varias réplicas drenen el outbox sin pisarse.
    """
    publicados = 0
    while publicados < limite:
        with pool.connection() as conn:
            fila = conn.execute(
                "SELECT id, routing_key, payload FROM outbox WHERE publicada_en IS NULL "
                "ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED"
            ).fetchone()
            if not fila:
                break
            outbox_id, routing_key, payload = fila
            publicar(routing_key, payload)
            conn.execute("UPDATE outbox SET publicada_en = now() WHERE id = %s", (outbox_id,))
        publicados += 1
    return publicados
