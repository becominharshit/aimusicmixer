FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY backend/pyproject.toml ./pyproject.toml
RUN uv pip install --system --no-cache -r pyproject.toml || pip install --no-cache-dir .

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY assets/test-audio /app/assets/test-audio

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=7860

RUN mkdir -p /tmp/mixbench_sessions /tmp/mixbench_uploads && chmod -R 1777 /tmp/mixbench_sessions /tmp/mixbench_uploads

EXPOSE 7860

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}
