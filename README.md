# tep-ihm

IHM (Interface Homem-Maquina) para o experimento Tennessee Eastman. Dashboard web que exibe em tempo real o estado da planta e as decisoes do operator Kubernetes supervisorio.

## O que ela faz

A IHM conecta em duas fontes de dados e apresenta tudo numa interface web unica:

| Fonte | Protocolo | O que mostra |
|-------|-----------|-------------|
| Planta TEP | gRPC `StreamMetrics` | 22 XMEAS, 12 XMV, alarmes, ISD, tempo de simulacao |
| Operator K8s | API do Kubernetes (watch) | Fase, acoes tomadas, faixas configuradas |

Hoje apenas o painel da planta esta implementado. O painel do operator sera ativado com a issue #41, quando a logica supervisoria estiver funcionando.

## Como funciona

```
┌──────────────────────────────────────────────────────────────┐
│  Navegador (localhost:8080)                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Chart.js — graficos de pressao, temperatura, nivel,    │ │
│  │  vazao atualizando em tempo real via WebSocket           │ │
│  │  Tabelas de XMEAS e XMV, painel de alarmes              │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │ WebSocket (ws://localhost:8080/ws)│
│  ┌────────────────────────┴────────────────────────────────┐ │
│  │  Backend Python (FastAPI + Uvicorn)                      │ │
│  │                                                          │ │
│  │  1. Conecta na planta via gRPC StreamMetrics             │ │
│  │  2. Recebe metricas a cada 500ms                         │ │
│  │  3. Converte protobuf → JSON                             │ │
│  │  4. Faz broadcast pra todos os WebSockets conectados     │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │ gRPC (planta:50051)              │
└───────────────────────────┼──────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │  te-plant (Rust)           │
              │  Container Docker          │
              │  gRPC server :50051        │
              │  StreamMetrics → XMEAS,    │
              │  XMV, alarmes, ISD         │
              └───────────────────────────┘
```

### Fluxo de dados

1. O backend abre um **gRPC stream** com a planta (`StreamMetrics`). A planta envia um `PlantMetrics` a cada 500ms (configuravel via `STREAM_INTERVAL_MS`).
2. O backend converte cada mensagem protobuf em JSON e faz broadcast via **WebSocket** para todos os navegadores conectados.
3. O frontend recebe o JSON e atualiza 4 graficos Chart.js (pressao, temperatura, niveis, vazoes), tabelas de valores atuais (XMEAS e XMV), e o painel de alarmes.
4. Se a planta entrar em **emergency shutdown** (ISD), um banner vermelho aparece no topo da tela.
5. Se o gRPC cair, o backend tenta reconectar a cada 3 segundos. Se o WebSocket cair, o frontend tenta reconectar a cada 2 segundos.

### Reconexao automatica

Tanto o backend quanto o frontend tem reconexao automatica. Voce pode iniciar a IHM antes da planta — quando a planta subir, a conexao se estabelece sozinha.

## Stack

| Camada | Tecnologia | Por que |
|--------|-----------|---------|
| Backend | **FastAPI** (Python) | Framework async com suporte nativo a WebSocket. Leve e sem boilerplate. |
| Servidor ASGI | **Uvicorn** | Servidor async de alta performance pra FastAPI. |
| gRPC client | **grpcio** + stubs gerados por **grpcio-tools** | Consome o `StreamMetrics` da planta. Os stubs sao gerados a partir do mesmo `.proto` da planta. |
| Serialização | **Protocol Buffers** (protobuf) | Formato binario usado pela planta. O backend converte pra JSON antes de enviar pro frontend. |
| Comunicacao tempo real | **WebSocket** | Conexao persistente entre backend e frontend. Mais eficiente que polling HTTP pra dados que mudam a cada 500ms. |
| Graficos | **Chart.js 4** (CDN) | Biblioteca de graficos leve, sem build step. Renderiza diretamente no canvas do navegador. |
| Frontend | **HTML + CSS + JS puro** | Sem framework (React, Vue, etc). O dashboard é simples o suficiente pra nao precisar. |

## Dependencias

### Runtime

- **Python >= 3.11**
- **Planta TEP rodando** e acessivel via gRPC (default: `localhost:50051`)

### Pacotes Python (gerenciados pelo Poetry)

| Pacote | Versao | Uso |
|--------|--------|-----|
| fastapi | ^0.115 | Framework web async |
| uvicorn[standard] | ^0.34 | Servidor ASGI |
| websockets | ^15.0 | Implementacao WebSocket pro Uvicorn |
| grpcio | ^1.72 | Client gRPC |
| grpcio-tools | ^1.72 | Gerador de stubs Python a partir do `.proto` |
| protobuf | ^6.30 | Runtime protobuf |

### Dev

| Pacote | Uso |
|--------|-----|
| ruff | Linter e formatter |

### Externos (nao sao pacotes Python)

- **Docker** — pra rodar a planta como container
- **Proto file** — `proto/tep/v1/plant.proto` copiado do repo `fork-tennesseeEastman`. Os stubs em `gen/` sao gerados a partir dele e nao vao pro git.

## Setup

```bash
# 1. Instalar dependencias
poetry install

# 2. Gerar stubs gRPC (necessario na primeira vez e quando o proto mudar)
poetry run python -m grpc_tools.protoc \
  -I proto \
  --python_out=gen \
  --grpc_python_out=gen \
  proto/tep/v1/plant.proto

# 3. Rodar (planta precisa estar acessivel na porta 50051)
poetry run python src/server.py
```

Acesse `http://localhost:8080`

### Variaveis de ambiente

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `PLANT_ADDRESS` | `localhost:50051` | Endereco gRPC da planta |
| `STREAM_INTERVAL_MS` | `500` | Intervalo de amostragem do stream (ms) |
| `PORT` | `8080` | Porta HTTP do dashboard |

## Estrutura do projeto

```
tep-ihm/
├── proto/tep/v1/plant.proto   # Definicao do servico gRPC (copiado da planta)
├── gen/                       # Stubs Python gerados (gitignored)
├── src/
│   └── server.py              # Backend FastAPI + gRPC client + WebSocket
├── static/
│   ├── index.html             # Dashboard HTML
│   ├── app.js                 # Logica dos graficos e WebSocket
│   └── style.css              # Visual dark theme
├── pyproject.toml             # Dependencias (Poetry)
└── Dockerfile                 # Container da IHM
```

## Melhorias planejadas

### Curto prazo
- **Dockerfile** — containerizar a IHM pra rodar ao lado da planta e do Kind sem precisar de Poetry/Python instalado
- **Painel do operator** — mostrar fase (Stable/Transient/Alarm), faixas configuradas, historico de acoes. Depende da #41.
- **Selecao de XMEAS** — permitir escolher quais variaveis aparecem nos graficos em vez de ter graficos fixos

### Medio prazo
- **Historico persistente** — salvar metricas num SQLite ou arquivo pra poder ver historico mesmo depois de reiniciar
- **Marcadores de eventos** — mostrar no grafico quando o operator tomou uma acao (linha vertical + anotacao)
- **Export CSV** — botao pra exportar os dados visíveis
- **Graficos XMV** — adicionar graficos das variaveis manipuladas, nao so as medidas

### Longo prazo
- **Painel de disturbios** — mostrar IDVs ativos na planta (quando expostos via gRPC)
- **Multi-planta** — conectar em mais de uma instancia da planta ao mesmo tempo

## Issues

- [#42 — IHM / Dashboard](https://github.com/orgs/Green-Cinnamon-Labs/projects/6/views/1?pane=issue&itemId=167881610&issue=Green-Cinnamon-Labs%7Cspec-tennessee-eastman%7C42)
