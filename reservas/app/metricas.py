from prometheus_client import Counter, Gauge, Histogram

# Buckets en segundos; incluyen 0.8 porque la alerta de latencia usa p95 de POST /reservas > 800 ms.
SOLICITUDES = Counter(
    "reservas_http_requests_total", "Requests HTTP", ["metodo", "ruta", "estado"]
)
LATENCIA = Histogram(
    "reservas_http_request_duration_seconds",
    "Latencia de los requests HTTP",
    ["metodo", "ruta"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5),
)

RESERVAS_CREADAS = Counter("reservas_creadas_total", "Reservas creadas")
RESERVAS_CONFIRMADAS = Counter("reservas_confirmadas_total", "Reservas confirmadas por pago aprobado")
RESERVAS_CANCELADAS = Counter("reservas_canceladas_total", "Reservas canceladas", ["motivo"])
RESERVAS_EXPIRADAS = Counter("reservas_expiradas_total", "Reservas expiradas por falta de pago")
CONFLICTOS = Counter("reservas_conflictos_total", "Intentos de reserva rechazados por franja ocupada (409)")

CONSULTAS_COCHERAS = Counter(
    "reservas_consultas_cocheras_total", "Consultas de Reservas a Cocheras", ["resultado"]
)
EVENTOS_PROCESADOS = Counter(
    "reservas_eventos_procesados_total", "Eventos recibidos de Pagos", ["tipo", "resultado"]
)
EVENTOS_PUBLICADOS = Counter(
    "reservas_eventos_publicados_total", "Eventos publicados en RabbitMQ", ["routing_key"]
)
OUTBOX_PENDIENTES = Gauge(
    "reservas_outbox_pendientes", "Eventos en el outbox que todavía no se publicaron"
)


def medir_outbox(pool) -> None:
    """El gauge consulta la base en cada scrape de Prometheus."""

    def pendientes() -> float:
        try:
            with pool.connection() as conn:
                return conn.execute("SELECT count(*) FROM outbox WHERE publicada_en IS NULL").fetchone()[0]
        except Exception:
            return float("nan")

    OUTBOX_PENDIENTES.set_function(pendientes)
