# syntax=docker/dockerfile:1

FROM caddy:2.11.9-alpine

RUN apk add --no-cache --virtual .setcap libcap-setcap \
 && setcap -r /usr/bin/caddy \
 && apk del .setcap \
 && addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy caddy \
 && mkdir -p /data/caddy /config/caddy \
 && chown -R caddy:caddy /data /config

COPY Caddyfile Caddyfile.dev routes.caddy /etc/caddy/
RUN caddy fmt --diff /etc/caddy/Caddyfile \
 && caddy fmt --diff /etc/caddy/Caddyfile.dev \
 && SITE_DOMAIN=example.com ACME_EMAIL=ops@example.com caddy validate --config /etc/caddy/Caddyfile \
 && caddy validate --config /etc/caddy/Caddyfile.dev

LABEL org.opencontainers.image.source="https://github.com/Murvanidz3/smsvio"
USER caddy
