from pathlib import Path

from psycopg_pool import ConnectionPool

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
# Clave arbitraria: serializa las migraciones cuando arrancan varias réplicas a la vez.
MIGRATIONS_LOCK = 724001


def crear_pool(url: str) -> ConnectionPool:
    pool = ConnectionPool(url, min_size=1, max_size=10, open=False)
    pool.open(wait=True, timeout=30)
    return pool


def migrar(pool: ConnectionPool) -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATIONS_LOCK,))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            conn.commit()
            aplicadas = {r[0] for r in conn.execute("SELECT nombre FROM schema_migrations")}
            for archivo in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if archivo.name in aplicadas:
                    continue
                conn.execute(archivo.read_text())
                conn.execute("INSERT INTO schema_migrations (nombre) VALUES (%s)", (archivo.name,))
                conn.commit()
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATIONS_LOCK,))
            conn.commit()
