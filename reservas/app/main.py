import logging
import time
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import config, db, eventos, logs, mensajeria, metricas, repository
from .expiracion import Expirador
from .schemas import FranjaOcupada, ReservaIn, ReservaOut

logs.configurar()
log = logging.getLogger("reservas.api")
log_http = logging.getLogger("reservas.http")

SIN_LOG_DE_ACCESO = {"/health", "/ready", "/metrics"}  # los llaman Docker y Prometheus cada pocos segundos


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = db.crear_pool(config.database_url())
    db.migrar(app.state.pool)
    metricas.medir_outbox(app.state.pool)
    # Sin RABBITMQ_URL el servicio corre sin mensajería (desarrollo y tests).
    url = config.rabbitmq_url()
    app.state.mensajeria = mensajeria.iniciar(app.state.pool, url) if url else []
    # La expiración solo usa la base (el aviso sale por el outbox), así que corre siempre.
    app.state.expirador = Expirador(app.state.pool, config.expiracion_intervalo_segundos())
    app.state.expirador.start()
    yield
    app.state.expirador.detener()
    app.state.expirador.join(timeout=5)
    mensajeria.detener(app.state.mensajeria)
    app.state.pool.close()


app = FastAPI(title="Reservas", lifespan=lifespan)


@app.middleware("http")
async def observabilidad(request: Request, call_next):
    """Fija el traceId del request (el del gateway o uno nuevo), lo devuelve en X-Trace-Id y
    registra una línea de log y las métricas HTTP de cada request."""
    trace = eventos.trace_id_de(request.headers.get("traceparent"))
    request.state.trace_id = trace
    usuario = _uuid_o_none(request.headers.get("x-user-id"))
    token_trace = logs.trace_id_var.set(trace)
    token_usuario = logs.usuario_id_var.set(usuario)
    inicio = time.perf_counter()
    estado = 500
    try:
        respuesta = await call_next(request)
        estado = respuesta.status_code
        respuesta.headers["X-Trace-Id"] = trace
        return respuesta
    finally:
        duracion = time.perf_counter() - inicio
        ruta_obj = request.scope.get("route")
        ruta = ruta_obj.path if ruta_obj else "no_encontrada"  # plantilla, para no multiplicar series
        metricas.SOLICITUDES.labels(request.method, ruta, str(estado)).inc()
        metricas.LATENCIA.labels(request.method, ruta).observe(duracion)
        if request.url.path not in SIN_LOG_DE_ACCESO:
            log_http.info(
                "%s %s %s", request.method, request.url.path, estado,
                extra={"metodo": request.method, "ruta": ruta, "estado": estado,
                       "duracionMs": round(duracion * 1000, 1), "traceId": trace, "usuarioId": usuario},
            )
        logs.trace_id_var.reset(token_trace)
        logs.usuario_id_var.reset(token_usuario)


def _uuid_o_none(valor: str | None) -> str | None:
    try:
        return str(UUID(valor)) if valor else None
    except ValueError:
        return None


def trace_id(request: Request) -> str:
    return request.state.trace_id


def usuario_actual(x_user_id: Annotated[str | None, Header()] = None) -> UUID:
    # Provisorio: el gateway valida el JWT y reenvía el id del usuario en X-User-Id.
    # Debe confirmarse con el responsable del gateway (ver docs/contratos.md).
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Falta autenticación")
    try:
        return UUID(x_user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Usuario inválido")


@app.get("/metrics", include_in_schema=False)
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready(request: Request):
    try:
        with request.app.state.pool.connection() as conn:
            conn.execute("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "no disponible"})
    if not all(h.conectado for h in request.app.state.mensajeria):
        return JSONResponse(status_code=503, content={"status": "sin conexión a RabbitMQ"})
    return {"status": "ok"}


@app.post("/reservas", response_model=ReservaOut, status_code=201)
def crear_reserva(
    body: ReservaIn,
    request: Request,
    response: Response,
    conductor_id: Annotated[UUID, Depends(usuario_actual)],
    trace: Annotated[str, Depends(trace_id)],
    idempotency_key: Annotated[str | None, Header()] = None,
):
    if not idempotency_key:
        raise HTTPException(status_code=422, detail="Falta el header Idempotency-Key")
    try:
        reserva, creada = repository.crear_reserva(
            request.app.state.pool,
            conductor_id=conductor_id,
            cochera_id=body.cochera_id,
            propietario_id=body.propietario_id,
            desde=body.desde,
            hasta=body.hasta,
            monto=body.monto,
            idempotency_key=idempotency_key,
            retencion_minutos=config.retencion_minutos(),
            trace_id=trace,
        )
    except repository.FranjaOcupada:
        log.info("Franja ocupada", extra={"cocheraId": str(body.cochera_id)})
        raise HTTPException(status_code=409, detail="Esa franja acaba de ser reservada")
    except repository.ClaveDeOtroUsuario:
        raise HTTPException(status_code=409, detail="Idempotency-Key ya utilizada")
    if creada:
        log.info("Reserva creada", extra={"reservaId": str(reserva["id"]), "cocheraId": str(body.cochera_id)})
    else:
        log.info("Idempotency-Key repetida: se devuelve la reserva existente",
                 extra={"reservaId": str(reserva["id"])})
        response.status_code = 200
    return reserva


@app.get("/reservas", response_model=list[ReservaOut])
def listar_reservas(
    request: Request,
    usuario_id: Annotated[UUID, Depends(usuario_actual)],
    rol: Literal["conductor", "propietario"] = "conductor",
):
    return repository.listar_reservas(request.app.state.pool, usuario_id, rol)


@app.get("/reservas/{reserva_id}", response_model=ReservaOut)
def obtener_reserva(
    reserva_id: UUID, request: Request, usuario_id: Annotated[UUID, Depends(usuario_actual)]
):
    try:
        return repository.obtener_reserva(request.app.state.pool, reserva_id, usuario_id)
    except repository.NoEncontrada:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")


@app.post("/reservas/{reserva_id}/cancelar", response_model=ReservaOut)
def cancelar_reserva(
    reserva_id: UUID,
    request: Request,
    usuario_id: Annotated[UUID, Depends(usuario_actual)],
    trace: Annotated[str, Depends(trace_id)],
):
    try:
        reserva = repository.cancelar_reserva(request.app.state.pool, reserva_id, usuario_id, trace)
        log.info("Reserva cancelada", extra={"reservaId": str(reserva_id)})
        return reserva
    except repository.NoEncontrada:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    except repository.NoSePuedeCancelar as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/cocheras/{cochera_id}/ocupacion", response_model=list[FranjaOcupada])
def ocupacion(
    cochera_id: UUID,
    request: Request,
    desde: Annotated[datetime, Query()],
    hasta: Annotated[datetime, Query()],
):
    if desde.tzinfo is None or hasta.tzinfo is None or hasta <= desde:
        raise HTTPException(status_code=422, detail="desde y hasta deben tener zona horaria y hasta > desde")
    return repository.ocupacion(request.app.state.pool, cochera_id, desde, hasta)
