import os


def database_url() -> str:
    return os.environ["DATABASE_URL"]


def retencion_minutos() -> int:
    return int(os.environ.get("RETENCION_MINUTOS", "10"))


def rabbitmq_url() -> str | None:
    return os.environ.get("RABBITMQ_URL") or None


def expiracion_intervalo_segundos() -> float:
    return float(os.environ.get("EXPIRACION_INTERVALO_SEGUNDOS", "60"))


def cocheras_url() -> str:
    return os.environ["COCHERAS_URL"]
