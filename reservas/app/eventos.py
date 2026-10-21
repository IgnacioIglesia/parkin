import uuid
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

MONEDA = "UYU"


def trace_id_de(traceparent: str | None) -> str:
    """Extrae el traceId del header W3C `traceparent` (00-<traceId>-<spanId>-<flags>)."""
    if traceparent:
        partes = traceparent.split("-")
        if len(partes) == 4 and len(partes[1]) == 32:
            return partes[1]
    return uuid.uuid4().hex


def encolar(conn, routing_key: str, reserva: dict, trace_id: str, motivo: str | None = None) -> None:
    """Guarda un evento en el outbox, dentro de la transacción de `conn`."""
    datos = {
        "reservaId": str(reserva["id"]),
        "cocheraId": str(reserva["cochera_id"]),
        "conductorId": str(reserva["conductor_id"]),
        "propietarioId": str(reserva["propietario_id"]),
        "desde": reserva["desde"].isoformat(),
        "hasta": reserva["hasta"].isoformat(),
        "monto": reserva["monto"],
        "moneda": MONEDA,
        "estado": reserva["estado"],
    }
    if reserva.get("expira_en") and reserva["estado"] == "PENDIENTE_PAGO":
        datos["expiraEn"] = reserva["expira_en"].isoformat()
    if motivo:
        datos["motivo"] = motivo
    evento = {
        "eventId": str(uuid.uuid4()),
        "tipo": routing_key,
        "ocurridoEn": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "traceId": trace_id,
        "datos": datos,
    }
    conn.execute(
        "INSERT INTO outbox (routing_key, payload) VALUES (%s, %s)", (routing_key, Jsonb(evento))
    )
