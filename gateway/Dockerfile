FROM nginx:1.27-alpine

# njs: valida el JWT en el gateway sin llamar a Usuarios en cada request.
RUN apk add --no-cache nginx-module-njs

COPY nginx.conf /etc/nginx/nginx.conf
COPY jwt.js /etc/nginx/jwt.js
COPY snippets /etc/nginx/snippets

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
