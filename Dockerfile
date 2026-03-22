FROM python:3.12-slim

WORKDIR /app

# Dependencias de sistema pro grpcio
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false

# Copiar dependencias primeiro (cache de camada)
COPY pyproject.toml poetry.lock ./
RUN poetry install --no-dev --no-interaction

# Copiar proto e gerar stubs
COPY proto/ proto/
RUN mkdir -p gen/tep/v1 && \
    python -m grpc_tools.protoc \
        -I proto \
        --python_out=gen \
        --grpc_python_out=gen \
        proto/tep/v1/plant.proto

# Copiar codigo
COPY src/ src/
COPY static/ static/

EXPOSE 8080

ENV PLANT_ADDRESS=host.docker.internal:50051
ENV PORT=8080

CMD ["python", "src/server.py"]
