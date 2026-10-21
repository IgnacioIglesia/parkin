# The Twelve-Factor App

Marcar los factores que realmente aplicamos y explicar cómo (la letra pide mencionarlo brevemente).

| # | Factor | Aplicado | Cómo |
|---|---|---|---|
| I | Codebase | ☐ | Un repo, un deploy por servicio |
| II | Dependencies | ☐ | |
| III | Config | ☐ | Variables de entorno (`.env.example`) |
| IV | Backing services | ☐ | Postgres y RabbitMQ como recursos adjuntos por URL/env |
| V | Build, release, run | ☐ | |
| VI | Processes | ☐ | Servicios sin estado |
| VII | Port binding | ☐ | |
| VIII | Concurrency | ☐ | Escalado horizontal por proceso |
| IX | Disposability | ☐ | |
| X | Dev/prod parity | ☐ | docker compose |
| XI | Logs | ☐ | Logs a stdout |
| XII | Admin processes | ☐ | Migraciones como comando aparte |
