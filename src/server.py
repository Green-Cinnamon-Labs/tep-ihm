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
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


PLANT_ADDRESS = os.environ.get("PLANT_ADDRESS", "localhost:50051")
STREAM_INTERVAL_MS = float(os.environ.get("STREAM_INTERVAL_MS", "500"))
CSV_REPLAY = os.environ.get("CSV_REPLAY", "")

connected_clients: set[WebSocket] = set()
latest_snapshot: dict | None = None


async def broadcast(snapshot: dict):
    """Envia snapshot pra todos os WebSockets conectados."""
    global latest_snapshot, connected_clients
    latest_snapshot = snapshot
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


# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    if CSV_REPLAY:
        task = asyncio.create_task(csv_replay_loop())
    else:
        task = asyncio.create_task(plant_stream_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(static_dir / "index.html"))


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
