import contextlib
import contextvars
import json
import logging
import os
import sys
from datetime import datetime, timezone

SERVICIO = "reservas"

trace_id_var = contextvars.ContextVar("trace_id", default=None)
usuario_id_var = contextvars.ContextVar("usuario_id", default=None)
reserva_id_var = contextvars.ContextVar("reserva_id", default=None)

_CONTEXTO = (("traceId", trace_id_var), ("usuarioId", usuario_id_var), ("reservaId", reserva_id_var))
_ESTANDAR = set(logging.makeLogRecord({}).__dict__)


class JsonFormatter(logging.Formatter):
    """Una línea JSON por log. Incluye el contexto del request (traceId, usuarioId, reservaId)
    y cualquier campo pasado con `extra=`; estos últimos tienen prioridad."""

    def format(self, record: logging.LogRecord) -> str:
        datos = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "nivel": record.levelname,
            "servicio": SERVICIO,
            "logger": record.name,
            "mensaje": record.getMessage(),
        }
        for campo, variable in _CONTEXTO:
            valor = variable.get()
            if valor:
                datos[campo] = valor
        for campo, valor in record.__dict__.items():
            if campo not in _ESTANDAR and campo not in ("message", "asctime", "color_message"):
                datos[campo] = valor
        if record.exc_info:
            datos["error"] = self.formatException(record.exc_info)
        return json.dumps(datos, default=str, ensure_ascii=False)


def configurar() -> None:
    """Logs JSON a stdout (12-Factor XI). Idempotente."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    raiz = logging.getLogger()
    raiz.handlers = [handler]
    raiz.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

    # uvicorn usa sus propios handlers; se redirigen al formato JSON.
    # El access log de uvicorn se reemplaza por el del middleware (con traceId).
    for nombre in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(nombre)
        logger.handlers = []
        logger.propagate = True
    acceso = logging.getLogger("uvicorn.access")
    acceso.handlers = []
    acceso.propagate = False


@contextlib.contextmanager
def contexto(**campos):
    """Fija traceId, usuarioId o reservaId para los logs emitidos dentro del bloque."""
    variables = {"trace_id": trace_id_var, "usuario_id": usuario_id_var, "reserva_id": reserva_id_var}
    tokens = [(variables[nombre], variables[nombre].set(valor)) for nombre, valor in campos.items()]
    try:
        yield
    finally:
        for variable, token in reversed(tokens):
            variable.reset(token)
