import logging
import secrets
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import httpx

from . import metricas

log = logging.getLogger("reservas.cocheras")

CONSULTA = "query($id: ID!) { cochera(id: $id) { propietario { id } precioHora } }"


class CocheraNoEncontrada(Exception):
    pass


class CocherasNoDisponible(Exception):
    pass


class ClienteCocheras:
    """Consulta síncrona a Cocheras (GraphQL) para obtener el propietario y el precio por hora.

    Reservas no confía en lo que mande el cliente: el propietario y el monto salen de acá.
    """

    def __init__(self, url: str, transport: httpx.BaseTransport | None = None, timeout: float = 3.0):
        self.endpoint = url.rstrip("/") + "/graphql"
        self._http = httpx.Client(timeout=timeout, transport=transport)

    def cochera(self, cochera_id: UUID, trace_id: str) -> tuple[UUID, Decimal]:
        """Devuelve (propietario_id, precio_hora). Lanza CocheraNoEncontrada o CocherasNoDisponible."""
        try:
            respuesta = self._http.post(
                self.endpoint,
                json={"query": CONSULTA, "variables": {"id": str(cochera_id)}},
                # Se propaga el traceId; el spanId es nuevo (este servicio es un salto más).
                headers={"traceparent": f"00-{trace_id}-{secrets.token_hex(8)}-01"},
            )
            respuesta.raise_for_status()
            cuerpo = respuesta.json()
            # GraphQL responde 200 aun con errores: hay que mirar el cuerpo.
            if cuerpo.get("errors"):
                raise ValueError(f"Cocheras respondió con errores: {cuerpo['errors'][0].get('message')}")
            cochera = cuerpo["data"]["cochera"]
            if cochera is None:
                metricas.CONSULTAS_COCHERAS.labels("no_encontrada").inc()
                raise CocheraNoEncontrada()
            propietario = UUID(cochera["propietario"]["id"])
            precio = Decimal(str(cochera["precioHora"]))
            if precio <= 0:
                raise ValueError("precioHora inválido")
        except CocheraNoEncontrada:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError, ArithmeticError) as e:
            metricas.CONSULTAS_COCHERAS.labels("error").inc()
            log.warning("No se pudo consultar Cocheras", extra={"cocheraId": str(cochera_id), "error": str(e)})
            raise CocherasNoDisponible() from e
        metricas.CONSULTAS_COCHERAS.labels("ok").inc()
        return propietario, precio

    def cerrar(self) -> None:
        self._http.close()


def calcular_monto(precio_hora: Decimal, desde: datetime, hasta: datetime) -> Decimal:
    """precioHora × horas de la franja, con centavos. 90 minutos a $100/h son $150."""
    segundos = Decimal(int((hasta - desde).total_seconds()))
    return (precio_hora * segundos / Decimal(3600)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
