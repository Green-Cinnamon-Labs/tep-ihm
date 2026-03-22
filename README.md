# tep-ihm

IHM (Interface Homem-Máquina) para o experimento Tennessee Eastman.

Dashboard web que mostra em tempo real:
- **Painel da planta** — XMEAS, MVs, alarmes (via gRPC StreamMetrics)
- **Painel do operator** — fase, ações tomadas, faixas configuradas (via K8s API)

## Arquitetura

```
Container: te-plant (gRPC :50051)
Container: Kind (operator como Pod)
Processo local: tep-ihm (:8080)
    ├── gRPC → te-plant (métricas tempo real)
    └── K8s API → Kind (status do operator)  [futuro]
```

A IHM roda fora do Docker e fora do Kubernetes. É um processo Python local.

## Setup

```bash
poetry install
```

### Gerar stubs gRPC

```bash
python -m grpc_tools.protoc \
  -I proto \
  --python_out=gen \
  --grpc_python_out=gen \
  proto/tep/v1/plant.proto
```

## Rodar

```bash
# Planta precisa estar rodando na porta 50051
poetry run tep-ihm
```

Acesse `http://localhost:8080`

## Issues

- [#42 — IHM / Dashboard](https://github.com/orgs/Green-Cinnamon-Labs/projects/6/views/1?pane=issue&itemId=167881610&issue=Green-Cinnamon-Labs%7Cspec-tennessee-eastman%7C42)
