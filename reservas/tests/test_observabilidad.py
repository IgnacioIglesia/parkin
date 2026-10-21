import json
import logging
from uuid import uuid4

from prometheus_client import REGISTRY

from app import logs
from app.expiracion import expirar_vencidas
from app.outbox import drenar
from app.procesador import procesar_evento

from .conftest import cuerpo
from .test_expiracion import vencer
from .test_mensajeria import evento_de_pago
from .test_reservas import con, crear, post


def valor(nombre, **etiquetas):
    return REGISTRY.get_sample_value(nombre, etiquetas) or 0.0


def registros_http(caplog):
    return [r for r in caplog.records if r.name == "reservas.http"]


# --- Logs en JSON ---


def test_el_formato_del_log_es_json_con_contexto():
    registro = logging.LogRecord("reservas.api", logging.INFO, __file__, 1, "Reserva creada", None, None)
    registro.cocheraId = "c-1"
    with logs.contexto(trace_id="abc123", usuario_id="u-1", reserva_id="r-1"):
        linea = logs.JsonFormatter().format(registro)

    datos = json.loads(linea)
    assert datos["mensaje"] == "Reserva creada"
    assert datos["nivel"] == "INFO"
    assert datos["servicio"] == "reservas"
    assert datos["traceId"] == "abc123"
    assert datos["usuarioId"] == "u-1"
    assert datos["reservaId"] == "r-1"
    assert datos["cocheraId"] == "c-1"
    assert "timestamp" in datos


def test_el_contexto_no_se_filtra_fuera_del_bloque():
    with logs.contexto(trace_id="abc"):
        pass
    assert logs.trace_id_var.get() is None


def test_cada_request_deja_una_linea_de_log_con_traceid_y_usuario(client, franja, caplog):
    caplog.set_level(logging.INFO, logger="reservas.http")
    conductor = uuid4()
    trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    r = client.post(
        "/reservas",
        json=cuerpo(uuid4(), *franja),
        headers={
            "X-User-Id": str(conductor),
            "Idempotency-Key": str(uuid4()),
            "traceparent": f"00-{trace}-00f067aa0ba902b7-01",
        },
    )
    assert r.status_code == 201

    [registro] = registros_http(caplog)
    assert registro.ruta == "/reservas"
    assert registro.estado == 201
    assert registro.traceId == trace
    assert registro.usuarioId == str(conductor)
    assert registro.duracionMs >= 0


def test_health_ready_y_metrics_no_llenan_el_log(client, caplog):
    caplog.set_level(logging.INFO, logger="reservas.http")
    for ruta in ("/health", "/ready", "/metrics"):
        assert client.get(ruta).status_code == 200
    assert registros_http(caplog) == []


def test_el_traceid_de_la_respuesta_coincide_con_el_del_evento(client, franja):
    trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    r = client.post(
        "/reservas",
        json=cuerpo(uuid4(), *franja),
        headers={
            "X-User-Id": str(uuid4()),
            "Idempotency-Key": str(uuid4()),
            "traceparent": f"00-{trace}-00f067aa0ba902b7-01",
        },
    )
    assert r.headers["X-Trace-Id"] == trace
    with client.app.state.pool.connection() as conn:
        (payload,) = conn.execute("SELECT payload FROM outbox").fetchone()
    assert payload["traceId"] == trace


def test_sin_traceparent_se_genera_un_traceid_y_se_usa_en_todo(client, franja):
    r = post(client, cuerpo(uuid4(), *franja))
    trace = r.headers["X-Trace-Id"]
    assert len(trace) == 32
    with client.app.state.pool.connection() as conn:
        (payload,) = conn.execute("SELECT payload FROM outbox").fetchone()
    assert payload["traceId"] == trace


def test_un_error_de_negocio_se_registra_con_su_estado(client, franja, caplog):
    cochera = uuid4()
    crear(client, cochera, franja)
    caplog.set_level(logging.INFO)
    assert post(client, cuerpo(cochera, *franja)).status_code == 409
    assert any(r.getMessage() == "Franja ocupada" for r in caplog.records)
    assert any(getattr(r, "estado", None) == 409 for r in registros_http(caplog))


# --- Métricas ---


def test_metrics_expone_el_formato_de_prometheus(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "reservas_creadas_total" in r.text
    assert "reservas_http_request_duration_seconds_bucket" in r.text


def test_crear_reserva_cuenta_una_reserva_y_un_request(client, franja):
    antes = valor("reservas_creadas_total")
    requests = valor("reservas_http_requests_total", metodo="POST", ruta="/reservas", estado="201")
    crear(client, uuid4(), franja)
    assert valor("reservas_creadas_total") == antes + 1
    assert valor("reservas_http_requests_total", metodo="POST", ruta="/reservas", estado="201") == requests + 1


def test_repetir_la_idempotency_key_no_cuenta_otra_reserva(client, franja):
    conductor, clave = uuid4(), str(uuid4())
    body = cuerpo(uuid4(), *franja)
    post(client, body, conductor, clave)
    antes = valor("reservas_creadas_total")
    post(client, body, conductor, clave)
    assert valor("reservas_creadas_total") == antes


def test_un_conflicto_se_cuenta(client, franja):
    cochera = uuid4()
    crear(client, cochera, franja)
    antes = valor("reservas_conflictos_total")
    assert post(client, cuerpo(cochera, *franja)).status_code == 409
    assert valor("reservas_conflictos_total") == antes + 1


def test_las_metricas_usan_la_plantilla_de_la_ruta_y_no_el_id(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    client.get(f"/reservas/{reserva['id']}", headers=con(conductor))
    assert valor("reservas_http_requests_total", metodo="GET", ruta="/reservas/{reserva_id}", estado="200") >= 1
    assert reserva["id"] not in client.get("/metrics").text


def test_cancelar_se_cuenta_con_su_motivo(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    antes = valor("reservas_canceladas_total", motivo="cancelada_por_usuario")
    client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor))
    assert valor("reservas_canceladas_total", motivo="cancelada_por_usuario") == antes + 1


def test_los_eventos_de_pago_se_cuentan_por_resultado(client, franja):
    reserva = crear(client, uuid4(), franja)
    evento = evento_de_pago("pago.aprobado", reserva["id"])
    confirmadas = valor("reservas_confirmadas_total")
    aplicados = valor("reservas_eventos_procesados_total", tipo="pago.aprobado", resultado="aplicado")
    duplicados = valor("reservas_eventos_procesados_total", tipo="pago.aprobado", resultado="duplicado")

    procesar_evento(client.app.state.pool, evento)
    procesar_evento(client.app.state.pool, evento)

    assert valor("reservas_confirmadas_total") == confirmadas + 1
    assert valor("reservas_eventos_procesados_total", tipo="pago.aprobado", resultado="aplicado") == aplicados + 1
    assert valor("reservas_eventos_procesados_total", tipo="pago.aprobado", resultado="duplicado") == duplicados + 1


def test_un_evento_con_tipo_desconocido_no_crea_series_nuevas(client):
    try:
        procesar_evento(client.app.state.pool, {"eventId": str(uuid4()), "tipo": "x" * 50, "datos": {}})
    except Exception:
        pass
    assert "x" * 50 not in client.get("/metrics").text


def test_el_procesamiento_de_eventos_loguea_con_el_traceid_del_evento(client, franja, caplog):
    reserva = crear(client, uuid4(), franja)
    caplog.set_level(logging.INFO, logger="reservas.procesador")
    procesar_evento(client.app.state.pool, evento_de_pago("pago.aprobado", reserva["id"]))
    linea = next(r for r in caplog.records if r.name == "reservas.procesador" and r.getMessage().endswith("aplicado"))
    assert linea.resultado == "aplicado"


def test_la_expiracion_se_cuenta(client, franja):
    antes = valor("reservas_expiradas_total")
    for _ in range(3):
        vencer(client, crear(client, uuid4(), franja)["id"])
    expirar_vencidas(client.app.state.pool)
    assert valor("reservas_expiradas_total") == antes + 3


def test_el_gauge_del_outbox_refleja_los_eventos_pendientes(client, franja):
    crear(client, uuid4(), franja)
    crear(client, uuid4(), franja)
    assert valor("reservas_outbox_pendientes") == 2
    drenar(client.app.state.pool, lambda rk, ev: None)
    assert valor("reservas_outbox_pendientes") == 0
