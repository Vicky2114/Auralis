# Auralis backend — FastAPI + Pipecat + Gemini Live (WebRTC via aiortc).
FROM python:3.11-slim

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# System libs aiortc needs for media (opus/vpx/srtp) + ffmpeg for av.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        libopus0 \
        libvpx-dev \
        libsrtp2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached layer). --no-dev skips the test group; --frozen
# pins exactly to uv.lock.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen

# App code.
COPY . .

ENV HOST=0.0.0.0 \
    PORT=7860 \
    PYTHONUNBUFFERED=1

EXPOSE 7860

CMD ["uv", "run", "--no-dev", "python", "server.py"]
