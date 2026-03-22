"""
tep-ihm — servidor FastAPI com WebSocket para streaming de métricas da planta TEP.

Conecta na planta via gRPC StreamMetrics e repassa os dados pro frontend via WebSocket.
"""

import asyncio
import json
import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import grpc

# Adicionar o diretório gen ao path pra importar os stubs
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
from tep.v1 import plant_pb2, plant_pb2_grpc


PLANT_ADDRESS = os.environ.get("PLANT_ADDRESS", "localhost:50051")
STREAM_INTERVAL_MS = float(os.environ.get("STREAM_INTERVAL_MS", "500"))

# Clientes WebSocket conectados
connected_clients: set[WebSocket] = set()

# Último snapshot recebido da planta (pra enviar ao novo cliente que conectar)
latest_snapshot: dict | None = None


async def plant_stream_loop():
    """Loop que conecta na planta via gRPC e faz broadcast pros WebSockets."""
    global latest_snapshot

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
                latest_snapshot = snapshot

                # Broadcast pra todos os clientes conectados
                msg = json.dumps(snapshot)
                disconnected = set()
                for ws in connected_clients:
                    try:
                        await ws.send_text(msg)
                    except Exception:
                        disconnected.add(ws)
                connected_clients -= disconnected

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(plant_stream_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

# Servir arquivos estáticos (frontend)
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

    # Enviar último snapshot imediatamente
    if latest_snapshot:
        await ws.send_text(json.dumps(latest_snapshot))

    try:
        # Manter conexão aberta (mensagens do frontend ignoradas por ora)
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.discard(ws)
        print(f"[ihm] cliente desconectou ({len(connected_clients)} restantes)")


def main():
    import uvicorn
    port = int(os.environ.get("PORT", "8080"))
    print(f"[ihm] iniciando em http://localhost:{port}")
    print(f"[ihm] planta em {PLANT_ADDRESS}")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
