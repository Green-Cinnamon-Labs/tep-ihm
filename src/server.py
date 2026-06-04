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
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))
import persistence


PLANT_ADDRESS = os.environ.get("PLANT_ADDRESS", "localhost:50051")
STREAM_INTERVAL_MS = float(os.environ.get("STREAM_INTERVAL_MS", "500"))
CSV_REPLAY = os.environ.get("CSV_REPLAY", "")
K8S_ENABLED = os.environ.get("K8S_ENABLED", "true").lower() not in ("0", "false", "no")
K8S_NAMESPACE = os.environ.get("K8S_NAMESPACE", "default")
K8S_CR_NAME = os.environ.get("K8S_CR_NAME", "tep-baseline")
K8S_SERVER  = os.environ.get("K8S_SERVER", "")   # ex: https://host.docker.internal:6443
ACTIVE_IDV = []  # Controlled via /disturbances/update endpoint
IDV_MAGNITUDES: dict[int, float] = {4: 5.0}  # magnitude por IDV (padrão: IDV4 = +5°C)
RECORD_CSV_PATH = os.environ.get("RECORD_CSV_PATH", "/data/recording.csv")

connected_clients: set[WebSocket] = set()
latest_snapshot: dict | None = None
latest_operator_state: dict | None = None
_csv_writer = None  # instância de csv.writer ou None
_csv_file = None
_csv_lock = asyncio.Lock()
_recording_active = False  # controle manual de gravação
_plant_task: asyncio.Task | None = None
_MAX_PLANT_RETRIES = 3
_plant_connection_failed = False

CSV_HEADER = (
    ["t_h"]
    + [f"xmeas_{i+1}" for i in range(41)]
    + [f"xmv_{i+1}"   for i in range(12)]
    + ["operator_phase"]
)


def _open_csv(path: str, append: bool = True):
    """Abre o arquivo CSV e retorna (file, writer). Escreve header se novo."""
    global _csv_writer, _csv_file, _recording_active
    if _csv_file:
        _csv_file.close()
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if (append and p.exists()) else "w"
    _csv_file   = open(p, mode, newline="", buffering=1)
    _csv_writer = csv.writer(_csv_file)
    if mode == "w":
        _csv_writer.writerow(CSV_HEADER)
    _recording_active = True


def _close_csv():
    """Fecha o arquivo CSV sem deletar. Para de gravar."""
    global _csv_writer, _csv_file, _recording_active
    if _csv_file:
        _csv_file.close()
    _csv_writer = None
    _csv_file = None
    _recording_active = False


def _append_row(snapshot: dict):
    """Appenda uma linha ao CSV com os dados do snapshot atual. Só grava se _recording_active."""
    if _csv_writer is None or not _recording_active:
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
    _append_row(snapshot)
    persistence.maybe_append(snapshot)
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

async def broadcast_status(msg: dict):
    """Envia mensagem de status (sem gravar em CSV) para todos os WebSockets."""
    text = json.dumps(msg)
    disconnected = set()
    for ws in connected_clients:
        try:
            await ws.send_text(text)
        except Exception:
            disconnected.add(ws)
    connected_clients.difference_update(disconnected)


async def plant_stream_loop():
    """Tenta conectar na planta via gRPC até _MAX_PLANT_RETRIES vezes.
    Após esgotar as tentativas, para e notifica os clientes via WebSocket."""
    global _plant_connection_failed
    import grpc

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
    from tep.v1 import plant_pb2, plant_pb2_grpc

    retries = 0

    while retries < _MAX_PLANT_RETRIES:
        channel = None
        try:
            channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
            stub = plant_pb2_grpc.PlantServiceStub(channel)
            request = plant_pb2.StreamMetricsRequest(interval_ms=STREAM_INTERVAL_MS)
            stream = stub.StreamMetrics(request)

            _connected = False
            async for metrics in stream:
                if not _connected:
                    print(f"[ihm] conectado na planta em {PLANT_ADDRESS}")
                    retries = 0
                    _plant_connection_failed = False
                    _connected = True
                    # Reenviar estado ativo ao reconectar (planta pode ter reiniciado)
                    if ACTIVE_IDV or IDV_MAGNITUDES:
                        try:
                            resync_stub = plant_pb2_grpc.PlantServiceStub(channel)
                            resync_req = plant_pb2.UpdateDisturbancesRequest(
                                active_idv=[int(x) for x in ACTIVE_IDV],
                                idv_magnitudes={int(k): float(v) for k, v in IDV_MAGNITUDES.items()},
                            )
                            await resync_stub.UpdateDisturbances(resync_req)
                            print(f"[ihm] estado IDV reenviado à planta: {ACTIVE_IDV}")
                        except Exception as resync_err:
                            print(f"[ihm] aviso: falha ao reenviar IDV: {resync_err}")
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
            retries += 1
            if retries < _MAX_PLANT_RETRIES:
                print(f"[ihm] gRPC erro: {e.code()} — tentativa {retries}/{_MAX_PLANT_RETRIES}, reconectando em 3s...")
                await asyncio.sleep(3)
            else:
                print(f"[ihm] gRPC erro: {e.code()} — {_MAX_PLANT_RETRIES} tentativas esgotadas. Aguardando reconexão manual.")

        except Exception as e:
            retries += 1
            if retries < _MAX_PLANT_RETRIES:
                print(f"[ihm] erro inesperado: {e} — tentativa {retries}/{_MAX_PLANT_RETRIES}, reconectando em 3s...")
                await asyncio.sleep(3)
            else:
                print(f"[ihm] erro inesperado: {e} — {_MAX_PLANT_RETRIES} tentativas esgotadas. Aguardando reconexão manual.")

        finally:
            if channel:
                try:
                    await channel.close()
                except Exception:
                    pass

    _plant_connection_failed = True
    await broadcast_status({"plant_connection": "failed"})


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
    print(f"[ihm] gravação CSV disponível: {RECORD_CSV_PATH} (aguardando /recording/start)")
    _default_db = str(Path(__file__).resolve().parent.parent / "data" / "sessions.db")
    db_path = os.environ.get("SQLITE_DB_PATH", _default_db)
    persistence.init_db(db_path)
    source_type = "csv_replay" if CSV_REPLAY else "grpc"
    address = CSV_REPLAY if CSV_REPLAY else PLANT_ADDRESS
    persistence.get_or_create_data_source(
        name=f"TEP Plant ({source_type})",
        source_type=source_type,
        address=address,
    )
    print(f"[ihm] SQLite persistence: {db_path}")
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
    _close_csv()
    persistence.stop_session()


app = FastAPI(lifespan=lifespan)

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.post("/api/reconnect")
async def reconnect_plant():
    global _plant_task, _plant_connection_failed
    if _plant_task and not _plant_task.done():
        return {"status": "already_running"}
    _plant_connection_failed = False
    _plant_task = asyncio.create_task(plant_stream_loop())
    print("[ihm] reconexão manual iniciada")
    return {"status": "reconnecting"}


@app.get("/supervisor")
async def supervisor_status():
    return latest_operator_state or {"phase": "Unknown", "connected": False}


@app.get("/")
async def index():
    return FileResponse(str(static_dir / "dashboard" / "index.html"))


@app.get("/recording.csv")
async def download_csv():
    """Download do CSV gravado."""
    p = Path(RECORD_CSV_PATH)
    if not p.exists():
        return Response("Nenhum dado gravado ainda.", status_code=404, media_type="text/plain")
    return FileResponse(str(p), media_type="text/csv", filename="recording.csv")


@app.post("/recording/reset")
async def reset_csv():
    """Limpa o CSV e começa nova gravação."""
    _open_csv(RECORD_CSV_PATH, append=False)
    print(f"[ihm] gravação CSV reiniciada: {RECORD_CSV_PATH}")
    return {"status": "ok", "path": RECORD_CSV_PATH, "recording": True}


@app.post("/recording/start")
async def start_recording():
    """Inicia gravação (cria ou reseta CSV)."""
    _open_csv(RECORD_CSV_PATH, append=False)
    print(f"[ihm] gravação iniciada: {RECORD_CSV_PATH}")
    return {"status": "ok", "path": RECORD_CSV_PATH, "recording": True}


@app.post("/recording/stop")
async def stop_recording():
    """Para a gravação (fecha arquivo sem deletar)."""
    _close_csv()
    print(f"[ihm] gravação parada: {RECORD_CSV_PATH}")
    return {"status": "ok", "path": RECORD_CSV_PATH, "recording": False}


@app.post("/simulation/control")
async def control_simulation(payload: dict):
    """Controla simulação (pause, resume). Recebe { 'action': 'pause'|'resume' }."""
    try:
        import grpc
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
        from tep.v1 import plant_pb2, plant_pb2_grpc

        action_str = payload.get("action", "").lower()
        action_map = {
            "pause": plant_pb2.ControlSimulationRequest.Action.PAUSE,
            "resume": plant_pb2.ControlSimulationRequest.Action.RESUME,
            "reset": plant_pb2.ControlSimulationRequest.Action.RESET,
        }

        if action_str not in action_map:
            return Response(f"Ação inválida: {action_str}", status_code=400, media_type="text/plain")

        # Envia comando para planta via gRPC (não-blocking)
        if not CSV_REPLAY:
            async def send_control_command():
                try:
                    channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
                    stub = plant_pb2_grpc.PlantServiceStub(channel)
                    request = plant_pb2.ControlSimulationRequest(action=action_map[action_str])
                    response = await stub.ControlSimulation(request)
                    await channel.close()
                    print(f"[ihm] simulação {action_str}: {response.message}")
                except Exception as plant_err:
                    print(f"[ihm] aviso: não pude controlar simulação: {plant_err}")

            asyncio.create_task(send_control_command())

        return {"status": "ok", "action": action_str}
    except Exception as e:
        print(f"[ihm] erro ao controlar simulação: {e}")
        return Response(f"Erro: {e}", status_code=400, media_type="text/plain")


@app.post("/simulation/speed")
async def set_simulation_speed(payload: dict):
    """Define velocidade de simulação. Recebe { 'factor': 0.0 } (0=max, 1=real-time, N=Nx)."""
    try:
        import grpc
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
        from tep.v1 import plant_pb2, plant_pb2_grpc

        factor = float(payload.get("factor", 1.0))

        if not CSV_REPLAY:
            async def _send():
                try:
                    channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
                    stub = plant_pb2_grpc.PlantServiceStub(channel)
                    req = plant_pb2.SetSpeedRequest(factor=factor)
                    resp = await stub.SetSpeed(req)
                    await channel.close()
                    print(f"[ihm] velocidade → factor={resp.factor}")
                except Exception as err:
                    print(f"[ihm] aviso: não pude ajustar velocidade: {err}")

            asyncio.create_task(_send())

        return {"status": "ok", "factor": factor}
    except Exception as e:
        print(f"[ihm] erro ao ajustar velocidade: {e}")
        return Response(f"Erro: {e}", status_code=400, media_type="text/plain")


@app.post("/disturbances/update")
async def update_disturbances(payload: dict):
    """Atualiza a lista de distúrbios ativos em tempo real. Recebe { 'active_idv': [list] }."""
    global ACTIVE_IDV
    try:
        import grpc
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
        from tep.v1 import plant_pb2, plant_pb2_grpc

        new_active = payload.get("active_idv", [])
        ACTIVE_IDV = sorted([int(x) for x in new_active if isinstance(x, int)])

        # Atualiza planta via gRPC se conectada (não-blocking)
        if not CSV_REPLAY:
            async def update_plant_disturbances():
                try:
                    channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
                    stub = plant_pb2_grpc.PlantServiceStub(channel)
                    request = plant_pb2.UpdateDisturbancesRequest(
                        active_idv=[int(x) for x in ACTIVE_IDV],
                        idv_magnitudes={int(k): float(v) for k, v in IDV_MAGNITUDES.items()},
                    )
                    response = await stub.UpdateDisturbances(request)
                    await channel.close()
                    print(f"[ihm] disturbios atualizados na planta: {ACTIVE_IDV}")
                except Exception as plant_err:
                    print(f"[ihm] aviso: não pude atualizar planta: {plant_err}")

            asyncio.create_task(update_plant_disturbances())
        else:
            print(f"[ihm] modo CSV replay: distúrbios apenas locais: {ACTIVE_IDV}")

        return {"status": "ok", "active_idv": ACTIVE_IDV}
    except Exception as e:
        print(f"[ihm] erro ao atualizar distúrbios: {e}")
        return Response(f"Erro: {e}", status_code=400, media_type="text/plain")


@app.post("/disturbances/magnitude")
async def update_idv_magnitude(payload: dict):
    """Define a magnitude de um IDV step. Recebe { 'idv': 4, 'magnitude': 10.0 }"""
    global IDV_MAGNITUDES
    try:
        import grpc
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
        from tep.v1 import plant_pb2, plant_pb2_grpc

        idv_num = int(payload.get("idv", 0))
        magnitude = float(payload.get("magnitude", 5.0))
        if idv_num < 1 or idv_num > 20:
            return Response("IDV inválido", status_code=400, media_type="text/plain")

        IDV_MAGNITUDES[idv_num] = magnitude

        if not CSV_REPLAY:
            async def _push():
                try:
                    channel = grpc.aio.insecure_channel(PLANT_ADDRESS)
                    stub = plant_pb2_grpc.PlantServiceStub(channel)
                    req = plant_pb2.UpdateDisturbancesRequest(
                        active_idv=[int(x) for x in ACTIVE_IDV],
                        idv_magnitudes={int(k): float(v) for k, v in IDV_MAGNITUDES.items()},
                    )
                    await stub.UpdateDisturbances(req)
                    await channel.close()
                    print(f"[ihm] IDV({idv_num}) magnitude → {magnitude}")
                except Exception as err:
                    print(f"[ihm] aviso: não pude propagar magnitude: {err}")
            asyncio.create_task(_push())

        return {"status": "ok", "idv": idv_num, "magnitude": magnitude}
    except Exception as e:
        return Response(f"Erro: {e}", status_code=400, media_type="text/plain")


@app.get("/analytics")
async def analytics_page():
    return FileResponse(str(static_dir / "analytics" / "index.html"))


# ── Capture session API ───────────────────────────────────────────────────────

@app.get("/api/capture/status")
async def capture_status():
    sid = persistence.active_session_id()
    if sid is None:
        return {"active": False, "session_id": None}
    session = persistence.get_session(sid)
    charts  = persistence.list_chart_captures(sid)
    return {"active": True, "session_id": sid, "session": session, "charts": charts}


@app.post("/api/sessions")
async def session_create(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        return Response("name is required", status_code=400, media_type="text/plain")
    description = (payload.get("description") or "").strip()
    sid = persistence.create_session(name, description)
    print(f"[ihm] session created: {sid} — '{name}'")
    return {"status": "ok", "session_id": sid}


@app.post("/api/sessions/{session_id}/charts")
async def session_add_chart(session_id: int, payload: dict):
    label         = (payload.get("label") or "Chart").strip()
    selected_vars = payload.get("selected_vars") or []
    if not selected_vars:
        return Response("selected_vars is required", status_code=400, media_type="text/plain")
    chart = persistence.add_chart_capture(session_id, label, selected_vars)
    return chart


@app.delete("/api/sessions/{session_id}/charts/{chart_id}")
async def session_delete_chart(session_id: int, chart_id: int):
    ok = persistence.remove_chart_capture(chart_id)
    if not ok:
        return Response("chart not found", status_code=404, media_type="text/plain")
    return {"status": "ok", "chart_id": chart_id}


@app.post("/api/capture/start")
async def capture_start(payload: dict):
    session_id = payload.get("session_id")
    if session_id is None:
        return Response("session_id is required", status_code=400, media_type="text/plain")
    if persistence.active_session_id() is not None:
        return Response("a capture session is already active", status_code=409, media_type="text/plain")
    ok = persistence.start_recording(int(session_id))
    if not ok:
        return Response("session has no charts or does not exist", status_code=400, media_type="text/plain")
    print(f"[ihm] capture started: {session_id}")
    return {"status": "ok", "session_id": session_id}


@app.post("/api/capture/stop")
async def capture_stop():
    sid = persistence.stop_session()
    if sid is None:
        return Response("no active session", status_code=404, media_type="text/plain")
    print(f"[ihm] capture stopped: {sid}")
    return {"status": "ok", "session_id": sid}


@app.get("/api/sessions")
async def sessions_list():
    return persistence.list_sessions()


@app.get("/api/sessions/{session_id}")
async def session_get(session_id: int):
    s = persistence.get_session(session_id)
    if s is None:
        return Response("not found", status_code=404, media_type="text/plain")
    return s


@app.get("/api/sessions/{session_id}/charts")
async def session_charts(session_id: int):
    return persistence.list_chart_captures(session_id)


@app.get("/api/history")
async def history_query(
    chart_id: int,
    from_th: Optional[float] = None,
    to_th: Optional[float] = None,
):
    data = persistence.query_history(chart_id, from_th, to_th)
    if data is None:
        return Response("chart not found", status_code=404, media_type="text/plain")
    return data


@app.get("/api/sessions/{session_id}/export")
async def session_export(session_id: int):
    s = persistence.get_session(session_id)
    if s is None:
        return Response("not found", status_code=404, media_type="text/plain")
    csv_str = persistence.export_csv_str(session_id)
    filename = f"tep_session_{session_id}.csv"
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/sessions/{session_id}")
async def session_delete(session_id: int):
    if not persistence.delete_session(session_id):
        return Response("not found", status_code=404, media_type="text/plain")
    return {"status": "ok", "session_id": session_id}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.add(ws)
    print(f"[ihm] cliente WebSocket conectado ({len(connected_clients)} total)")

    if _plant_connection_failed:
        await ws.send_text(json.dumps({"plant_connection": "failed"}))
    elif latest_snapshot:
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
