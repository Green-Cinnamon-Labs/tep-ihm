# docker build -t tep-ihm:latest .
# docker run --rm -p 8080:8080 tep-ihm:latest
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false

# Copiar dependencias primeiro (cache de camada)
COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-interaction

# Copiar codigo
COPY src/ src/
COPY static/ static/

EXPOSE 8080

ENV OPCUA_ENDPOINT=opc.tcp://host.docker.internal:4840/tep/server/
ENV PORT=8080

CMD ["python", "src/server.py"]
