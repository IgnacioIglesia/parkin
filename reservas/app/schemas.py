from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator


class ReservaIn(BaseModel):
    # El propietario y el monto no los manda el cliente: Reservas los obtiene de Cocheras.
    cochera_id: UUID
    desde: datetime
    hasta: datetime

    @model_validator(mode="after")
    def validar_franja(self):
        if self.desde.tzinfo is None or self.hasta.tzinfo is None:
            raise ValueError("desde y hasta deben incluir zona horaria")
        if self.hasta <= self.desde:
            raise ValueError("hasta debe ser posterior a desde")
        return self


class ReservaOut(BaseModel):
    id: UUID
    cochera_id: UUID
    conductor_id: UUID
    propietario_id: UUID
    desde: datetime
    hasta: datetime
    estado: str
    monto: float
    expira_en: datetime | None
    creada_en: datetime


class FranjaOcupada(BaseModel):
    desde: datetime
    hasta: datetime
    estado: str
