import json
import logging
import threading

import pika
from psycopg_pool import ConnectionPool

from . import metricas
from .outbox import drenar
from .procesador import EventoInvalido, procesar_evento

log = logging.getLogger("reservas.mensajeria")

EXCHANGE = "cocheras.eventos"
COLA_PAGOS = "reservas.pago-eventos"  # declarada en infra/rabbitmq/definitions.json
REINTENTO_SEGUNDOS = 3


class Publicador(threading.Thread):
    """Lee el outbox y publica en RabbitMQ con publisher confirms.

    pika.BlockingConnection no es thread-safe, así que una única conexión vive en este hilo.
    """

    def __init__(self, pool: ConnectionPool, url: str):
        super().__init__(name="publicador", daemon=True)
        self.pool, self.url = pool, url
        self.conectado = False
        self._detener = threading.Event()

    def run(self):
        while not self._detener.is_set():
            try:
                with pika.BlockingConnection(pika.URLParameters(self.url)) as conexion:
                    canal = conexion.channel()
                    canal.confirm_delivery()
                    self.conectado = True
                    log.info("Publicador conectado a RabbitMQ")

                    def publicar(routing_key: str, evento: dict) -> None:
                        # mandatory: si ninguna cola recibe el mensaje, falla y se reintenta
                        # en lugar de perderlo en silencio.
                        canal.basic_publish(
                            EXCHANGE,
                            routing_key,
                            json.dumps(evento).encode(),
                            pika.BasicProperties(
                                content_type="application/json",
                                delivery_mode=2,
                                message_id=evento["eventId"],
                            ),
                            mandatory=True,
                        )
                        metricas.EVENTOS_PUBLICADOS.labels(routing_key).inc()

                    while not self._detener.is_set():
                        if drenar(self.pool, publicar) == 0:
                            conexion.process_data_events(time_limit=0.5)  # también mantiene el heartbeat
            except Exception:
                log.exception("Publicador desconectado; reintentando")
            finally:
                self.conectado = False
            self._detener.wait(REINTENTO_SEGUNDOS)

    def detener(self):
        self._detener.set()


class Consumidor(threading.Thread):
    """Consume los eventos de Pagos con ACK manual y prefetch 10."""

    def __init__(self, pool: ConnectionPool, url: str):
        super().__init__(name="consumidor", daemon=True)
        self.pool, self.url = pool, url
        self.conectado = False
        self._detener = threading.Event()
        self._conexion = None
        self._canal = None

    def run(self):
        while not self._detener.is_set():
            try:
                with pika.BlockingConnection(pika.URLParameters(self.url)) as conexion:
                    canal = conexion.channel()
                    # passive: la topología la crea RabbitMQ al arrancar; si todavía no está, reintenta.
                    canal.queue_declare(COLA_PAGOS, passive=True)
                    canal.basic_qos(prefetch_count=10)
                    canal.basic_consume(COLA_PAGOS, on_message_callback=self._al_recibir)
                    self._conexion, self._canal, self.conectado = conexion, canal, True
                    log.info("Consumidor conectado a %s", COLA_PAGOS)
                    canal.start_consuming()
            except Exception:
                log.exception("Consumidor desconectado; reintentando")
            finally:
                self.conectado = False
            self._detener.wait(REINTENTO_SEGUNDOS)

    def _al_recibir(self, canal, metodo, propiedades, cuerpo):
        try:
            resultado = procesar_evento(self.pool, json.loads(cuerpo))
        except (ValueError, EventoInvalido):
            # Mensaje que nunca va a poder procesarse: directo a la Dead Letter Queue.
            log.exception("Mensaje inválido, se envía a la DLQ")
            canal.basic_nack(metodo.delivery_tag, requeue=False)
            return
        except Exception:
            # Falla transitoria: vuelve a la cola. Tras 3 entregas la cola (x-delivery-limit)
            # lo manda a cocheras.dlq.
            log.exception("Error procesando el evento, se reencola")
            canal.basic_nack(metodo.delivery_tag, requeue=True)
            return
        log.info("Evento procesado: %s", resultado)
        canal.basic_ack(metodo.delivery_tag)

    def detener(self):
        self._detener.set()
        if self._conexion and self._canal:
            try:
                self._conexion.add_callback_threadsafe(self._canal.stop_consuming)
            except Exception:
                pass


def iniciar(pool: ConnectionPool, url: str) -> list:
    hilos = [Publicador(pool, url), Consumidor(pool, url)]
    for hilo in hilos:
        hilo.start()
    return hilos


def detener(hilos: list) -> None:
    for hilo in hilos:
        hilo.detener()
    for hilo in hilos:
        hilo.join(timeout=5)
