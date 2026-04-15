"""
tep-ihm — servidor FastAPI com WebSocket para streaming de métricas da planta TEP.

Dois modos de operação:
  - gRPC: conecta na planta real via StreamMetrics (default)
  - CSV replay: lê um CSV de simulação em loop (set CSV_REPLAY=<path>)
"""

import asyncio
import csv
import json
import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles


PLANT_ADDRESS = os.environ.get("PLANT_ADDRESS", "localhost:50051")
STREAM_INTERVAL_MS = float(os.environ.get("STREAM_INTERVAL_MS", "500"))
CSV_REPLAY = os.environ.get("CSV_REPLAY", "")
K8S_ENABLED = os.environ.get("K8S_ENABLED", "true").lower() not in ("0", "false", "no")
K8S_NAMESPACE = os.environ.get("K8S_NAMESPACE", "default")
K8S_CR_NAME = os.environ.get("K8S_CR_NAME", "tep-baseline")
K8S_SERVER  = os.environ.get("K8S_SERVER", "")   # ex: https://host.docker.internal:6443
ACTIVE_IDV  = [int(x) for x in os.environ.get("ACTIVE_IDV", "").split(",") if x.strip().isdigit()]
RECORD_CSV = os.environ.get("RECORD_CSV", "false").lower() not in ("0", "false", "no")
RECORD_CSV_PATH = os.environ.get("RECORD_CSV_PATH", "/data/recording.csv")

connected_clients: set[WebSocket] = set()
latest_snapshot: dict | None = None
latest_operator_state: dict | None = None
_csv_writer = None  # instância de csv.writer ou None
_csv_file = None
_csv_lock = asyncio.Lock()

CSV_HEADER = (
    ["t_h"]
    + [f"xmeas_{i+1}" for i in range(41)]
    + [f"xmv_{i+1}"   for i in range(12)]
    + ["operator_phase"]
)


def _open_csv(path: str, append: bool = True):
    """Abre o arquivo CSV e retorna (file, writer). Escreve header se novo."""
    global _csv_writer, _csv_file
    if _csv_file:
        _csv_file.close()
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if (append and p.exists()) else "w"
    _csv_file   = open(p, mode, newline="", buffering=1)
    _csv_writer = csv.writer(_csv_file)
    if mode == "w":
        _csv_writer.writerow(CSV_HEADER)


def _append_row(snapshot: dict):
    """Appenda uma linha ao CSV com os dados do snapshot atual."""
    if _csv_writer is None:
        return
    op_phase = (latest_operator_state or {}).get("phase", "")
    xmeas = snapshot.get("xmeas", [])
    xmv   = snapshot.get("xmv",   [])
    row = (
        [round(snapshot.get("t_h", 0.0), 6)]
        + [round(v, 6) for v in xmeas]
        + [round(v, 6) for v in xmv]
        + [op_phase]
    )
    _csv_writer.writerow(row)


async def broadcast(snapshot: dict):
    """Envia snapshot pra todos os WebSockets conectados."""
    global latest_snapshot, connected_clients
    snapshot["operator"]   = latest_operator_state
    snapshot["active_idv"] = ACTIVE_IDV
    latest_snapshot = snapshot
    if RECORD_CSV:
        _append_row(snapshot)
    msg = json.dumps(snapshot)
    disconnected = set()
    for ws in connected_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            disconnected.add(ws)
    connected_clients -= disconnected


# ── CSV Replay ────────────────────────────────────────────────────────────────

def parse_csv_row(header: list[str], row: list[str]) -> dict:
    """Converte uma linha do CSV no mesmo formato JSON que o gRPC stream produz."""
    values = {h: float(v) for h, v in zip(header, row)}

    xmeas = [values.get(f"XMEAS({i+1})", 0.0) for i in range(22)]
    xmv = [values.get(f"XMV({i+1})", 0.0) for i in range(12)]
    deriv_norm = values.get("deriv_norm", 0.0)

    # Indices YY presentes no CSV
    yy_keys = [k for k in header if k.startswith("YY[")]
    yy = {k: values.get(k, 0.0) for k in yy_keys}

    return {
        "t_h": values.get("t_h", 0.0),
        "xmeas": xmeas,
        "xmv": xmv,
        "alarms": [],
        "deriv_norm": deriv_norm,
        "isd_active": False,
        "yy": yy,
    }


async def csv_replay_loop():
    """Lê o CSV em loop, emitindo uma linha a cada STREAM_INTERVAL_MS."""
    interval = STREAM_INTERVAL_MS / 1000.0
    csv_path = Path(CSV_REPLAY)

    if not csv_path.exists():
        print(f"[ihm] CSV não encontrado: {csv_path}")
        return

    print(f"[ihm] modo replay CSV: {csv_path.name} ({interval:.1f}s intervalo)")

    while True:
        with open(csv_path, "r") as f:
            reader = csv.reader(f)
            header = next(reader)
            for row in reader:
                if len(row) != len(header):
                    continue
                snapshot = parse_csv_row(header, row)
                await broadcast(snapshot)
                await asyncio.sleep(interval)

        print("[ihm] CSV terminou, reiniciando loop...")


# ── gRPC Stream ───────────────────────────────────────────────────────────────

async def plant_stream_loop():
    """Loop que conecta na planta via gRPC e faz broadcast pros WebSockets."""
    import grpc

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
    from tep.v1 import plant_pb2, plant_pb2_grpc

    while True:
        try:
            channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
            stub = plant_pb2_grpc.PlantServiceStub(channel)

            request = plant_pb2.StreamMetricsRequest(interval_ms=STREAM_INTERVAL_MS)
            stream = stub.StreamMetrics(request)

            print(f"[ihm] conectado na planta em {PLANT_ADDRESS}")

            async for metrics in stream:
                snapshot = {
                    "t_h": metrics.t_h,
                    "xmeas": list(metrics.xmeas),
                    "xmv": list(metrics.xmv),
                    "alarms": [
                        {"variable": a.variable, "condition": a.condition, "active": a.active}
                        for a in metrics.alarms
                    ],
                    "deriv_norm": metrics.deriv_norm,
                    "isd_active": metrics.isd_active,
                }
                await broadcast(snapshot)

        except grpc.aio.AioRpcError as e:
            print(f"[ihm] gRPC erro: {e.code()} — reconectando em 3s...")
        except Exception as e:
            print(f"[ihm] erro inesperado: {e} — reconectando em 3s...")
        finally:
            try:
                await channel.close()
            except Exception:
                pass

        await asyncio.sleep(3)


# ── Kubernetes operator watch ─────────────────────────────────────────────────

def _k8s_watch_sync(custom, w):
    """Executa o watch síncrono do K8s — chamado via asyncio.to_thread para não bloquear o event loop."""
    global latest_operator_state
    for event in w.stream(
        custom.list_namespaced_custom_object,
        group="infrastructure.greenlabs.io",
        version="v1alpha1",
        namespace=K8S_NAMESPACE,
        plural="plcmachines",
        field_selector=f"metadata.name={K8S_CR_NAME}",
        timeout_seconds=60,
    ):
        obj = event.get("object", {})
        status = obj.get("status", {})
        spec = obj.get("spec", {})
        latest_operator_state = {
            "phase": status.get("phase", "Unknown"),
            "plantTime": status.get("plantTime"),
            "isdActive": status.get("isdActive", False),
            "lastReconcileTime": status.get("lastReconcileTime"),
            "lastAction": status.get("lastAction"),
            "variables": status.get("variables", []),
            "observation": status.get("observation", {}),
            "operatingRanges": spec.get("operatingRanges", []),
        }


async def operator_watch_loop():
    global latest_operator_state

    try:
        import urllib3
        from kubernetes import client as k8s_client, config as k8s_config, watch as k8s_watch
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except ImportError:
        print("[ihm] kubernetes lib não instalada — painel operator desabilitado")
        return

    print(f"[ihm] iniciando watch K8s: {K8S_NAMESPACE}/{K8S_CR_NAME}")

    while True:
        try:
            try:
                k8s_config.load_incluster_config()
            except k8s_config.ConfigException:
                k8s_config.load_kube_config()
                if K8S_SERVER:
                    cfg = k8s_client.Configuration.get_default_copy()
                    cfg.host = K8S_SERVER
                    cfg.verify_ssl = False
                    cfg.ssl_ca_cert = None
                    k8s_client.Configuration.set_default(cfg)

            custom = k8s_client.CustomObjectsApi()
            w = k8s_watch.Watch()

            await asyncio.to_thread(_k8s_watch_sync, custom, w)

        except Exception as e:
            print(f"[ihm] K8s watch erro: {e} — reconectando em 10s...")
            await asyncio.sleep(10)


# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    if RECORD_CSV:
        _open_csv(RECORD_CSV_PATH, append=True)
        print(f"[ihm] gravação CSV: {RECORD_CSV_PATH}")
    tasks = []
    if CSV_REPLAY:
        tasks.append(asyncio.create_task(csv_replay_loop()))
    else:
        tasks.append(asyncio.create_task(plant_stream_loop()))
    if K8S_ENABLED:
        tasks.append(asyncio.create_task(operator_watch_loop()))
    yield
    for t in tasks:
        t.cancel()
    if _csv_file:
        _csv_file.close()


app = FastAPI(lifespan=lifespan)

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(static_dir / "index.html"))


@app.get("/recording.csv")
async def download_csv():
    """Download do CSV gravado. Requer RECORD_CSV=true."""
    p = Path(RECORD_CSV_PATH)
    if not RECORD_CSV:
        return Response("RECORD_CSV não está ativo.", status_code=404, media_type="text/plain")
    if not p.exists():
        return Response("Nenhum dado gravado ainda.", status_code=404, media_type="text/plain")
    return FileResponse(str(p), media_type="text/csv", filename="recording.csv")


@app.post("/recording/reset")
async def reset_csv():
    """Limpa o CSV e começa nova gravação. Requer RECORD_CSV=true."""
    if not RECORD_CSV:
        return Response("RECORD_CSV não está ativo.", status_code=404, media_type="text/plain")
    _open_csv(RECORD_CSV_PATH, append=False)
    print(f"[ihm] gravação CSV reiniciada: {RECORD_CSV_PATH}")
    return {"status": "ok", "path": RECORD_CSV_PATH}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.add(ws)
    print(f"[ihm] cliente WebSocket conectado ({len(connected_clients)} total)")

    if latest_snapshot:
        await ws.send_text(json.dumps(latest_snapshot))

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.discard(ws)
        print(f"[ihm] cliente desconectou ({len(connected_clients)} restantes)")


def main():
    import uvicorn
    port = int(os.environ.get("PORT", "8080"))
    mode = f"replay CSV ({CSV_REPLAY})" if CSV_REPLAY else f"gRPC ({PLANT_ADDRESS})"
    print(f"[ihm] iniciando em http://localhost:{port}")
    print(f"[ihm] modo: {mode}")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
