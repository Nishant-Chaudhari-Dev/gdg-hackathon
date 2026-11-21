# Build from repo root:  docker build -f services/rag/Dockerfile .
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY shared /shared
COPY services/rag/requirements.txt ./requirements.txt
RUN pip install "/shared[gcp]" -r requirements.txt
COPY services/rag/app ./app
EXPOSE 8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --timeout-keep-alive 75
