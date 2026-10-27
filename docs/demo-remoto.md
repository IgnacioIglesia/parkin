# Demo remoto

Cómo mostrar parkIN desde otro dispositivo o a otra persona (la defensa, por ejemplo) sin desplegar nada en la nube: el sistema corre en una laptop y un túnel de Cloudflare lo publica en una URL.

## Requisitos (una sola vez)

```bash
brew install --cask docker     # y abrir Docker Desktop
brew install cloudflared
```

No hace falta cuenta de Cloudflare: se usan los túneles gratuitos (`trycloudflare.com`).

## Opción A (recomendada): un túnel a la web

```bash
git switch main && git pull
bash infra/demo-remoto.sh
```

El script levanta el sistema si hace falta, abre el túnel, espera a que la URL responda y reinicia la pasarela de prueba para que su página de pago salga por esa URL. Al final imprime algo como:

```
Abrí esta URL desde cualquier dispositivo:  https://algo-raro-1234.trycloudflare.com
```

Esa única URL sirve la web, la API, el WebSocket y la página de pago, todos en el mismo origen: no hay CORS que configurar ni variables que reconstruir, y funciona con cualquier navegador y desde el celular. Dejá la terminal abierta; `Ctrl+C` cierra el túnel y deja la pasarela como estaba.

## Cada vez que lo quiero iniciar

```bash
open -a Docker                                   # abrir Docker Desktop y esperar a que la ballena deje de moverse
cd ~/orca/projects/parkIN                        # (la carpeta donde está el repo)
docker compose up -d                             # arranca lo que esté parado; no borra datos
docker compose ps                                # todo en "healthy" (jwt-claves figura como Exited (0): es lo correcto)
tmux new -As demo                                # abre (o retoma) la sesión de tmux
bash infra/demo-remoto.sh --sin-levantar         # abre el túnel y muestra la URL
# Ctrl+B y después D: dejar corriendo y salir de tmux
```

Para volver a ver la URL o cerrar el túnel: `tmux attach -t demo` (y `Ctrl+C` para cerrarlo). Si cambiaste código, usá `docker compose up --build -d` en vez de `docker compose up -d`.

## Que no se apague solo

Todos los servicios del compose (menos `jwt-claves`, que corre una sola vez) tienen `restart: unless-stopped`: si Docker o la Mac se reinician, vuelven solos, bases de datos y RabbitMQ incluidos. Aun así, hay cuatro cosas que el sistema no puede hacer por sí mismo:

| Qué | Cómo evitar que se corte |
|---|---|
| Docker Desktop cerrado | Docker Desktop → Settings → General → **Start Docker Desktop when you sign in to your computer** |
| La Mac se duerme | Dejar la tapa abierta y, en otra ventana de tmux, `caffeinate -dims` |
| Cerrar la tapa | Con la tapa cerrada la Mac se duerme y el túnel se corta. Opciones: modo "clamshell" (conectada a la corriente con un monitor, teclado y mouse externos), o `sudo pmset -a disablesleep 1` (para deshacerlo: `sudo pmset -a disablesleep 0`). No la guardes en una mochila así: se calienta |
| El túnel | No es un contenedor: hay que correr `bash infra/demo-remoto.sh` y su URL cambia cada vez |

Para algo que quede encendido sin tu computadora hace falta un servidor (ver la opción B de más abajo).

## Opción B: el front de Vercel con el backend en tu laptop

Sirve si querés mostrar el despliegue de Vercel.

```bash
bash infra/demo-remoto.sh --modo gateway
```

El script abre el túnel hacia el gateway y te dice qué hacer: poner `VITE_API_URL=<la URL>` (sin barra final) en Vercel → Settings → Environment Variables, y hacer **Redeploy** (la variable se aplica al construir). El gateway acepta pedidos de los sitios `*.vercel.app` (CORS). Como la URL del túnel cambia en cada corrida, estos dos pasos se repiten cada vez: por eso la opción A es más cómoda.

## Cargar más cocheras

Una instalación nueva tiene casi ninguna cochera y la búsqueda queda vacía. Para llenarla con datos de demo:

```bash
node scripts/sembrar-cocheras.mjs                 # 40 cocheras
node scripts/sembrar-cocheras.mjs --cantidad 80   # hasta 200
node scripts/sembrar-cocheras.mjs --borrar        # las elimina
```

Con el sistema levantado, crea cocheras en los 10 barrios que ofrece el buscador (Pocitos, Punta Carretas, Parque Rodó, Cordón, Centro, Ciudad Vieja, Tres Cruces, Buceo, Malvín y Carrasco), con tipos de vehículo, precios y horarios variados (algunas 24 horas, otras solo de oficina o solo de noche), usando la misma API que usa la web. Se puede correr varias veces: no duplica, y si pedís más cantidad solo crea las que faltan.

Las cuentas de los propietarios de demo son `propietario-demo-1@demo.parkin`, `propietario-demo-2@demo.parkin`… con la contraseña `demo-parkin-2026`. Opciones: `--url` (por defecto `http://localhost:8080`) y `--prefijo` (para tener varios juegos de datos separados). Para sembrar en un sistema público, `--url https://<tu-túnel>.trycloudflare.com`.

Con 40 cocheras, la búsqueda de la web (radio de 1500 m) encuentra entre 3 y 10 por barrio, según el horario; de madrugada, menos, porque algunas no abren de noche.

## Probar el pago

1. Registrate como propietario y publicá una cochera (o usá una que ya exista), y desde otro usuario (o navegador) registrate como conductor.
2. Buscá la cochera, reservá y tocá **Pagar**: se abre la pasarela de prueba (`…/pasarela/checkout/mock-…`) con los botones **Aprobar** y **Rechazar**.
3. Aprobá: la reserva pasa a confirmada y los dos usuarios reciben el aviso en tiempo real. Rechazá: la reserva se cancela y se libera la franja.

La reserva se retiene 10 minutos; si se vence sin pagar, expira sola y, si después se aprueba en la pasarela, el pago se reembolsa.

## Si algo falla

| Síntoma | Qué pasa y qué hacer |
|---|---|
| `Error 1033` de Cloudflare al abrir la URL | El túnel todavía se está registrando, o se cerró. Esperá 30 segundos; si sigue, cerrá el script y corrélo de nuevo (la URL cambia) |
| El script dice que un servicio no está `healthy` | `docker compose ps` y `docker compose logs <servicio>`. Si recién levantó, esperá y reintentá con `--sin-levantar` |
| «No pude reiniciar la pasarela» al cerrar | `docker compose up -d pasarela-mock` |
| La página de pago abre en `localhost:8090` y no en la URL pública | La pasarela no se reinició con la URL: usá el script, o `PASARELA_PUBLIC_URL=<URL>/pasarela docker compose up -d pasarela-mock` |
| El pago dice «todavía no está disponible» | Pagos recién arrancó o todavía no recibió la reserva. Reintentá en unos segundos |
| Pide iniciar sesión de nuevo | Los tokens duran 15 minutos y se renuevan solos; si recargaste justo durante un refresh, alcanza con volver a entrar |

## Límites

- La URL cambia cada vez y vale mientras el script esté corriendo. Para una URL fija haría falta un túnel con nombre (cuenta de Cloudflare y un dominio), que no se configuró.
- Todo corre en una laptop: si se duerme o pierde internet, el demo se corta. Conviene probarlo un rato antes.
- La página de pago de la pasarela de prueba es pública a propósito (es una simulación). Con una pasarela real no existe.
- Mientras el túnel está abierto, cualquiera que tenga la URL puede usar la aplicación. Cerralo al terminar.
