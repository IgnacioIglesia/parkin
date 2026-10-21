import logging
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from . import config, db, eventos, mensajeria, repository
from .expiracion import Expirador
from .schemas import FranjaOcupada, ReservaIn, ReservaOut

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = db.crear_pool(config.database_url())
    db.migrar(app.state.pool)
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


def trace_id(traceparent: Annotated[str | None, Header()] = None) -> str:
    return eventos.trace_id_de(traceparent)


def usuario_actual(x_user_id: Annotated[str | None, Header()] = None) -> UUID:
    # Provisorio: el gateway valida el JWT y reenvía el id del usuario en X-User-Id.
    # Debe confirmarse con el responsable del gateway (ver docs/contratos.md).
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Falta autenticación")
    try:
        return UUID(x_user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Usuario inválido")


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
        raise HTTPException(status_code=409, detail="Esa franja acaba de ser reservada")
    except repository.ClaveDeOtroUsuario:
        raise HTTPException(status_code=409, detail="Idempotency-Key ya utilizada")
    if not creada:
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
        return repository.cancelar_reserva(request.app.state.pool, reserva_id, usuario_id, trace)
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
