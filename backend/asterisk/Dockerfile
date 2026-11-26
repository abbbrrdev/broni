FROM ubuntu:22.04
LABEL maintainer="ai-assistant"

ENV DEBIAN_FRONTEND=noninteractive

# Asterisk 18 из стандартного Ubuntu репо (jammy/universe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    asterisk \
    asterisk-modules \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Создаём нужные директории
RUN mkdir -p /var/spool/asterisk/recording \
             /var/lib/asterisk/sounds/custom \
             /var/log/asterisk

EXPOSE 5060/udp 8088 10000-10100/udp

CMD ["/usr/sbin/asterisk", "-f", "-vvv"]
