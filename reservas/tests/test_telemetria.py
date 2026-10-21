import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from app import telemetria

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"


@pytest.fixture
def exportador(monkeypatch):
    """Activa las trazas con un exportador en memoria, sin tocar el proveedor global."""
    exportador = InMemorySpanExporter()
    proveedor = TracerProvider()
    proveedor.add_span_processor(SimpleSpanProcessor(exportador))
    monkeypatch.setattr(telemetria, "_tracer", proveedor.get_tracer("pruebas"))
    return exportador


def test_sin_endpoint_no_se_activa_nada():
    assert telemetria.configurar(FastAPI()) is False
    assert telemetria.activa() is False


def test_sin_trazas_los_spans_de_evento_no_hacen_nada_y_no_rompen():
    with telemetria.span_de_evento("x", TRACE_ID, SpanKind.CONSUMER):
        assert telemetria.trace_id_actual() is None


def test_trace_id_actual_es_el_del_span_en_curso(exportador):
    tracer = trace.get_tracer("t")  # no-op: sin proveedor global no hay span válido
    with tracer.start_as_current_span("sin proveedor"):
        assert telemetria.trace_id_actual() is None
    with telemetria.span_de_evento("con traza", TRACE_ID, SpanKind.CONSUMER):
        assert telemetria.trace_id_actual() == TRACE_ID


def test_el_span_de_un_evento_queda_en_la_traza_del_evento(exportador):
    with telemetria.span_de_evento("procesar reserva.creada", TRACE_ID, SpanKind.CONSUMER, **{"reserva.id": "r-1"}):
        pass
    [span] = exportador.get_finished_spans()
    assert format(span.context.trace_id, "032x") == TRACE_ID
    assert span.kind == SpanKind.CONSUMER
    assert span.attributes["reserva.id"] == "r-1"
    assert span.parent is not None and span.parent.is_remote


def test_los_spans_internos_cuelgan_del_de_evento(exportador):
    tracer = telemetria._tracer
    with telemetria.span_de_evento("publicar reserva.confirmada", TRACE_ID, SpanKind.PRODUCER):
        with tracer.start_as_current_span("consulta sql"):
            pass
    hijo, padre = exportador.get_finished_spans()
    assert hijo.parent.span_id == padre.context.span_id
    assert format(hijo.context.trace_id, "032x") == TRACE_ID


@pytest.mark.parametrize("malo", [None, "", "no-es-hex", "0" * 32])
def test_un_traceid_invalido_abre_una_traza_nueva(exportador, malo):
    with telemetria.span_de_evento("x", malo, SpanKind.CONSUMER):
        nuevo = telemetria.trace_id_actual()
    assert nuevo and len(nuevo) == 32 and nuevo != malo


def test_fastapi_instrumentado_continua_la_traza_del_traceparent():
    """El span del request es hijo del `traceparent` entrante y los logs/eventos usan su traceId."""
    app = FastAPI()
    visto = {}

    @app.get("/cosa")
    def cosa():
        visto["trace"] = telemetria.trace_id_actual()
        return {}

    @app.get("/health")
    def health():
        return {}

    exportador = InMemorySpanExporter()
    assert telemetria.configurar(app, exportador=exportador, instrumentar_librerias=False)
    try:
        cliente = TestClient(app)
        cliente.get("/cosa", headers={"traceparent": f"00-{TRACE_ID}-00f067aa0ba902b7-01"})
        cliente.get("/health")
    finally:
        telemetria._tracer = None  # no dejar las trazas activas para el resto de las pruebas

    spans = [s for s in exportador.get_finished_spans() if s.kind == SpanKind.SERVER]
    assert len(spans) == 1, "/health no genera spans"
    assert format(spans[0].context.trace_id, "032x") == TRACE_ID
    assert spans[0].parent.span_id == int("00f067aa0ba902b7", 16)
    assert visto["trace"] == TRACE_ID
