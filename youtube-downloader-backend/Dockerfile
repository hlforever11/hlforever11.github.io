FROM node:22-bookworm-slim AS pot-builder

ARG POT_PROVIDER_VERSION=1.3.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      git \
      libcairo2-dev \
      libgif-dev \
      libjpeg62-turbo-dev \
      libpango1.0-dev \
      librsvg2-dev \
      pkg-config \
      python3 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${POT_PROVIDER_VERSION}" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil

WORKDIR /opt/bgutil/server
RUN npm ci \
    && npx tsc \
    && npm prune --omit=dev


FROM node:22-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      ffmpeg \
      libcairo2 \
      libgif7 \
      libjpeg62-turbo \
      libpango-1.0-0 \
      librsvg2-2 \
      python3 \
      python3-venv \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY --from=pot-builder /opt/bgutil/server/build /opt/pot-server/build
COPY --from=pot-builder /opt/bgutil/server/node_modules /opt/pot-server/node_modules
COPY --from=pot-builder /opt/bgutil/server/package.json /opt/pot-server/package.json

COPY app.py start.sh ./
RUN chmod +x /app/start.sh

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
