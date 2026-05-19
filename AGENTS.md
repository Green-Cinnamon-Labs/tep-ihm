# AGENTS.md

This file provides guidance to OpenAI Codex when working with code in this repository.


## Architecture

The entire backend lives in a single file: `src/server.py`. It is a FastAPI app with an async lifespan that starts background tasks for data ingestion.

**Two operation modes**, selected by environment variables at startup:

| Mode       | Env var                                     | Behavior                                                                                                 |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| gRPC live  | `PLANT_ADDRESS` (default `localhost:50051`) | `plant_stream_loop()` opens a gRPC `StreamMetrics` stream from tep-plant; reconnects every 3s on failure |
| CSV replay | `CSV_REPLAY=<path>`                         | `csv_replay_loop()` reads a simulation CSV in a loop, emitting one row per `STREAM_INTERVAL_MS`          |

Both modes call `broadcast(snapshot)`, which fans out JSON to all connected WebSocket clients and appends to a CSV recording (always enabled, controlled via UI buttons).

**Kubernetes operator watch** (`operator_watch_loop()`) runs concurrently when `K8S_ENABLED=true`. It uses `asyncio.to_thread` to run the synchronous `kubernetes.watch.Watch` without blocking the event loop. State is stored in the global `latest_operator_state` and merged into each broadcast.

**Frontend** (`static/`) is vanilla HTML + CSS + JS with no build step. Chart.js is loaded from CDN. The WebSocket client in `app.js` auto-reconnects every 2s on disconnect. `XMEAS_META` and `XMV_META` in `app.js` are the authoritative label/unit tables for the 41 measurements and 12 manipulated variables.

**Proto contract**: `proto/tep/v1/plant.proto` is a copy from the `tep-plant` repo. The IHM only uses `StreamMetrics` (the streaming RPC). Other RPCs in the proto (`GetPlantStatus`, `ListControllers`, `UpdateController`) are not consumed by the IHM.

## Key environment variables

| Variable             | Default               | Description                                             |
| -------------------- | --------------------- | ------------------------------------------------------- |
| `PLANT_ADDRESS`      | `localhost:50051`     | gRPC address of tep-plant                               |
| `STREAM_INTERVAL_MS` | `500`                 | Sampling interval in ms                                 |
| `CSV_REPLAY`         | ``                    | Path to CSV for replay mode (disables gRPC)             |
| `K8S_ENABLED`        | `true`                | Enable Kubernetes operator watch                        |
| `K8S_SERVER`         | ``                    | Override kubeconfig API server URL                      |
| `K8S_NAMESPACE`      | `default`             | Namespace for the PLCMachine CR                         |
| `K8S_CR_NAME`        | `tep-baseline`        | Name of the PLCMachine CR to watch                      |
| `RECORD_CSV_PATH`    | `/data/recording.csv` | Output path for CSV recording                           |
| `PORT`               | `8080`                | HTTP port                                               |

## Agent Rules

- Keep the frontend simple: vanilla HTML, CSS, and JavaScript under `static/`.
- Prefer small, localized changes in `src/server.py` and `static/app.js`.
- Do not split `src/server.py` into multiple modules unless the user explicitly asks for a refactor.
- Do not change `proto/tep/v1/plant.proto` without stating that it is a copy from `tep-plant`.
- If the proto changes, mention that gRPC stubs must be regenerated and the source contract must be updated in `tep-plant`.
- Do not change `XMEAS_META` or `XMV_META` without checking compatibility with the plant stream payload.
- Preserve both operation modes: gRPC live mode via `PLANT_ADDRESS` and CSV replay mode via `CSV_REPLAY`.
- Do not break WebSocket auto-reconnect behavior in `static/app.js`.
- Do not block the asyncio event loop with synchronous Kubernetes or file I/O.
- Kubernetes watch logic must remain optional and controlled by `K8S_ENABLED`.
- Do not run Kubernetes, Docker, deployment, or environment-changing commands unless explicitly authorized.
- For runtime validation, suggest commands instead of executing them unless the user authorizes execution.
- Before editing, provide a short plan and list the files to be modified.
- Keep responses short unless explicitly asked for detailed analysis.
- For cross-repository decisions, follow the root `CLAUDE.md` / `AGENTS.md` propagation rules.