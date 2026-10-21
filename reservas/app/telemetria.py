"""Trazas distribuidas con OpenTelemetry, exportadas por OTLP/HTTP a Jaeger.

Sin OTEL_EXPORTER_OTLP_ENDPOINT no hace nada (tests y desarrollo local). Con él instrumenta
FastAPI (un span por request, hijo del `traceparent` que llegue), httpx (la consulta a Cocheras,
que así continúa la misma traza) y psycopg (las consultas SQL).

Los eventos de RabbitMQ solo llevan el traceId (no el spanId), así que su publicación y su
procesamiento se enganchan a esa traza con un padre remoto de spanId desconocido, igual que en
Cocheras: en Jaeger aparecen en la misma traza como "padre desconocido".
"""
import contextlib
import os
import random

from opentelemetry import trace
from opentelemetry.trace import NonRecordingSpan, SpanContext, SpanKind, TraceFlags

_tracer = None


def activa() -> bool:
    return _tracer is not None


def configurar(app, exportador=None, instrumentar_librerias=True) -> bool:
    """Activa las trazas si hay endpoint OTLP. `exportador` permite inyectar uno en las pruebas."""
    global _tracer
    if exportador is None and not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False

    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor

    proveedor = TracerProvider(resource=Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "reservas")}))
    if exportador is None:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        proveedor.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    else:
        proveedor.add_span_processor(SimpleSpanProcessor(exportador))
    trace.set_tracer_provider(proveedor)
    _tracer = proveedor.get_tracer("reservas")

    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    # /health, /ready y /metrics los llaman Docker y Prometheus cada pocos segundos.
    FastAPIInstrumentor.instrument_app(
        app, tracer_provider=proveedor, excluded_urls="health,ready,metrics",
        exclude_spans=["send", "receive"],  # los spans internos de ASGI solo agregan ruido
    )
    if instrumentar_librerias:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor

        HTTPXClientInstrumentor().instrument(tracer_provider=proveedor)
        PsycopgInstrumentor().instrument(tracer_provider=proveedor)
    return True


def trace_id_actual() -> str | None:
    """traceId (32 hex) del span en curso, para que logs y eventos coincidan con Jaeger."""
    contexto = trace.get_current_span().get_span_context()
    return format(contexto.trace_id, "032x") if contexto.is_valid else None


@contextlib.contextmanager
def span_de_evento(nombre: str, trace_id: str | None, tipo: SpanKind, **atributos):
    """Abre un span dentro de la traza del evento (si hay traceId válido) o en una nueva."""
    if not activa():
        yield
        return
    try:
        id_numerico = int(trace_id, 16) if trace_id else 0
    except (TypeError, ValueError):
        id_numerico = 0
    contexto = None
    if id_numerico:
        padre = SpanContext(
            trace_id=id_numerico, span_id=random.getrandbits(64) or 1, is_remote=True,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
        )
        contexto = trace.set_span_in_context(NonRecordingSpan(padre))
    with _tracer.start_as_current_span(nombre, context=contexto, kind=tipo, attributes=atributos):
        yield
