"""Opt-in real HTTP smoke test; uses an injected classifier, never real ML.

Run after npm run build with Python 3.11+ and Flask/Waitress installed:
    python tests/wifi-e2e.py --run

All credentials, accounts, databases and logs are temporary. No ESP32 or model
file is required. The production Next server and actual Waitress receiver bind
only to loopback addresses on unused ports.
"""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
NODE_TOKEN = "a" * 32
INGEST_TOKEN = "b" * 32
MODEL_HASH = "f" * 64
PASSWORD = "Temporary WiFi smoke account password 2026"
AUDIO_BYTES = 88200


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def request(url, *, method="GET", headers=None, body=None):
    headers = {"Connection": "close", **(headers or {})}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        response = OPENER.open(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def wait_for(label, predicate, timeout=35):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except (OSError, urllib.error.URLError) as error:
            last_error = error
        time.sleep(0.15)
    raise AssertionError(f"Timed out waiting for {label}; last network error: {last_error}")


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Smoke:
    def __init__(self, directory, receiver_class, create_app, create_server):
        self.directory = directory
        self.receiver_class = receiver_class
        self.create_app = create_app
        self.create_server = create_server
        self.node = shutil.which("node")
        require(self.node is not None, "Node.js is required")
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.env = {**os.environ,
                    "FOREST_DATABASE_PATH": str(directory / "app.sqlite"),
                    "FOREST_INGEST_TOKEN": INGEST_TOKEN,
                    "FOREST_DEPLOYMENT": "local",
                    "FOREST_COOKIE_SECURE": "false",
                    "FOREST_SIMULATION_ENABLED": "false",
                    "NEXT_TELEMETRY_DISABLED": "1",
                    "VERCEL": "0",
                    "NODE_ENV": "production"}
        for key in ("FOREST_SYNC_URL", "FOREST_SYNC_TOKEN"):
            self.env[key] = ""
        self.config = {"nodes": {"node_A": {"id": "NODE-01", "token": NODE_TOKEN}},
                       "url": self.base + "/api/ingest", "ingest_token": INGEST_TOKEN,
                       "database": str(directory / "spool.sqlite")}
        self.process = self.log = self.receiver = self.server = self.thread = None
        self.server_map = {}
        self.cookie = None
        self.classifier_calls = 0

    def classify(self, raw):
        self.classifier_calls += 1
        return (0.95 if raw[0] == 0 else 0.2), MODEL_HASH

    def create_account(self):
        code = """
          import { createAccount } from './lib/server/accounts.mjs';
          import { getDatabase } from './lib/server/database.mjs';
          try { await createAccount({username: 'wifismoke', name: 'WiFi smoke',
            password: process.env.WIFI_SMOKE_PASSWORD, role: 'admin'}); }
          finally { getDatabase().close(); }
        """
        subprocess.run([self.node, "--input-type=module", "-e", code], cwd=ROOT,
                       env={**self.env, "WIFI_SMOKE_PASSWORD": PASSWORD},
                       stdin=subprocess.DEVNULL, capture_output=True, check=True,
                       timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def start_next(self):
        self.log = (self.directory / "next.log").open("ab")
        self.process = subprocess.Popen(
            [self.node, str(ROOT / "node_modules/next/dist/bin/next"), "start",
             "--hostname", "127.0.0.1", "--port", str(self.port)],
            cwd=ROOT, env=self.env, stdin=subprocess.DEVNULL,
            stdout=self.log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

        def ready():
            require(self.process.poll() is None, "Production Next server exited unexpectedly")
            return request(self.base + "/")[0] in (200, 307)

        wait_for("production Next server", ready, timeout=45)

    def stop_next(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process = None
        if self.log is not None:
            self.log.close()
            self.log = None

    def start_receiver(self):
        self.receiver = self.receiver_class(self.config, self.classify)
        self.server_map = {}
        self.server = self.create_server(self.create_app(self.receiver), host="127.0.0.1",
                                         port=0, map=self.server_map, threads=2,
                                         asyncore_loop_timeout=0.1)
        self.receiver_base = f"http://127.0.0.1:{self.server.effective_port}"
        self.thread = threading.Thread(target=self.server.run, name="smoke-waitress", daemon=True)
        self.thread.start()
        self.receiver.start()

    def stop_receiver(self):
        try:
            if self.server is not None:
                self.server.task_dispatcher.shutdown(cancel_pending=True, timeout=5)
                self.server.close()
                for channel in list(self.server_map.values()):
                    channel.close()
                self.server = None
            if self.thread is not None:
                self.thread.join(timeout=5)
                require(not self.thread.is_alive(), "Waitress did not stop")
                self.thread = None
        finally:
            if self.receiver is not None:
                self.receiver.close()
                self.receiver = None

    def login(self):
        status, headers, body = request(self.base + "/api/auth/login", method="POST",
                                        headers={"Origin": self.base},
                                        body={"username": "wifismoke", "password": PASSWORD})
        require(status == 200, f"Login failed: HTTP {status}: {body!r}")
        cookie = headers.get("Set-Cookie", "")
        require("HttpOnly" in cookie and "Secure" not in cookie, "Expected a local HTTP session cookie")
        self.cookie = cookie.split(";", 1)[0]

    def state(self):
        status, _, body = request(self.base + "/api/state", headers={"Cookie": self.cookie})
        require(status == 200, f"State request failed: HTTP {status}: {body!r}")
        return json.loads(body)

    def pending(self):
        with closing(sqlite3.connect(self.config["database"])) as db:
            return db.execute("SELECT count(*) FROM events WHERE delivered_at IS NULL").fetchone()[0]

    def location(self, counter, *, authenticated=True):
        return request(self.receiver_base + "/location", method="POST",
                       headers={"Authorization": "Bearer " + NODE_TOKEN} if authenticated else {},
                       body={"node_id": "node_A", "event_id": str(counter), "gps_fix": True,
                             "latitude": 8.51, "longitude": 124.81})

    def upload(self, counter, *, positive=True, authenticated=True):
        headers = {"Content-Type": "application/octet-stream", "X-Node-ID": "node_A",
                   "X-Event-ID": str(counter), "X-GPS-Fix": "true",
                   "X-GPS-Lat": "8.51", "X-GPS-Lng": "124.81"}
        if authenticated:
            headers["Authorization"] = "Bearer " + NODE_TOKEN
        raw = bytes(AUDIO_BYTES) if positive else b"\x01" + bytes(AUDIO_BYTES - 1)
        return request(self.receiver_base + "/upload", method="POST", headers=headers, body=raw)

    def wait_state(self, label, predicate):
        def check():
            state = self.state()
            return state if predicate(state) else None
        return wait_for(label, check)

    def run(self):
        self.create_account()
        self.start_next()
        self.login()
        require(len(self.state()["alerts"]) == 0, "Isolated app must begin with no incidents")
        self.start_receiver()

        require(self.location(10, authenticated=False)[0] == 401, "GPS requires node authentication")
        require(self.upload(20, authenticated=False)[0] == 401, "Audio requires node authentication")
        require(self.classifier_calls == 0, "Unauthenticated audio must not invoke the classifier")
        require(request(self.base + "/api/ingest", method="POST", body={})[0] == 401,
                "App ingestion requires its separate bearer token")

        require(self.location(10)[0] == 200, "GPS must be durably accepted")
        state = self.wait_state("forwarded GPS", lambda value: any(
            sensor["id"] == "NODE-01" and sensor.get("gpsFix") is True
            and sensor["lat"] == 8.51 and sensor["lng"] == 124.81 for sensor in value["sensors"]))
        require(len(state["alerts"]) == 0, "GPS must not create an incident")

        status, _, body = self.upload(20)
        response = json.loads(body)
        require(status == 200 and response.get("detected") is True and response.get("probability") == 0.95,
                f"Expected injected positive classification: HTTP {status}: {body!r}")
        state = self.wait_state("first positive incident", lambda value: len(value["alerts"]) == 1)
        alert = state["alerts"][0]
        require(alert["source"] == "SENSOR" and alert["locationBasis"] == "node_gps", "Incident must identify node GPS")
        require(alert["radiusM"] is None and alert["tdoa"] == [], "Incident must not invent sound localization")
        require((alert["lat"], alert["lng"]) == (8.51, 124.81), "Incident must retain recording-node coordinates")
        wait_for("first delivery acknowledgement", lambda: self.pending() == 0)
        events_before = len(state["nodeEvents"])
        calls_before = self.classifier_calls
        require(self.upload(20)[0] == 200, "Exact audio retry must return its durable result")
        require(self.classifier_calls == calls_before, "Retry must not rerun inference")
        require(len(self.state()["alerts"]) == 1 and len(self.state()["nodeEvents"]) == events_before,
                "Exact retry must not duplicate incidents or node events")

        status, _, body = self.upload(30, positive=False)
        require(status == 200 and json.loads(body).get("detected") is False, "Expected injected negative classification")
        state = self.wait_state("negative classification", lambda value: any(
            sensor["id"] == "NODE-01" and sensor.get("lastClassification", {}).get("probability") == 0.2
            for sensor in value["sensors"]))
        require(len(state["alerts"]) == 1, "Negative classification must not create an incident")
        require(len(state["nodeEvents"]) == events_before + 1, "Negative classification must be recorded")
        require(self.location(15)[0] == 409, "An unused older device counter must be rejected")
        require(self.upload(20, positive=False)[0] == 409, "Reused counter with changed audio must be rejected")
        wait_for("negative delivery acknowledgement", lambda: self.pending() == 0)

        status, _, html = request(self.base + "/incidents/" + alert["id"], headers={"Cookie": self.cookie})
        require(status == 200, "Incident page must render")
        text = html.decode("utf-8")
        require("Recording node position" in text and "Recording node GPS" in text, "Incident page must label node position")
        require("raw recording is not retained or available for playback" in text, "Incident page must explain absent audio")
        require("Demo waveform" not in text and "Time Difference of Arrival (TDoA) Analysis" not in text,
                "Real sensor incident must not present simulated waveform or TDoA")

        print("Passed live HTTP GPS, positive/negative classification, retries, authentication and incident labels.", flush=True)
        original_receiver_id = self.receiver.receiver_id
        self.stop_next()
        status, _, body = self.upload(40)
        require(status == 200 and json.loads(body).get("detected") is True, "Receiver must accept while app is offline")
        require(self.pending() == 1, "Offline observation must remain pending")
        calls_before = self.classifier_calls
        self.stop_receiver()
        self.start_receiver()
        require(self.receiver.receiver_id == original_receiver_id, "Receiver identity must survive restart")
        require(self.pending() == 1, "Pending observation must survive receiver restart")
        require(self.upload(40)[0] == 200 and self.classifier_calls == calls_before,
                "Post-restart retry must reuse classification, not repeat inference")
        self.start_next()
        self.login()
        state = self.wait_state("durable backlog after restart", lambda value: len(value["alerts"]) == 2)
        wait_for("recovered delivery acknowledgement", lambda: self.pending() == 0)
        require(len({item["id"] for item in state["alerts"]}) == 2, "Recovery must create exactly one additional incident")
        require(any(item["id"] == alert["id"] for item in state["alerts"]), "Original incident must survive app restart")
        require(self.upload(40)[0] == 200, "Delivered recovery event remains retryable")
        require(len(self.state()["alerts"]) == 2, "Recovered retry must not create a third incident")
        require(self.location(35)[0] == 409, "Device counter high-water mark must survive restart")
        print("Passed offline queue recovery across receiver and Next restarts; exactly two incidents.", flush=True)

    def close(self):
        try:
            self.stop_receiver()
        finally:
            self.stop_next()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="start temporary local services and run the smoke test")
    args = parser.parse_args()
    if not args.run:
        parser.print_help()
        return 0
    require((ROOT / ".next/BUILD_ID").is_file(), "Run npm run build before this opt-in test")
    sys.path.insert(0, str(ROOT / "receiver"))
    from receiver import Receiver, create_app
    from waitress import create_server

    with tempfile.TemporaryDirectory(prefix="forest-wifi-e2e-") as temp:
        smoke = Smoke(Path(temp), Receiver, create_app, create_server)
        try:
            smoke.run()
        except BaseException:
            log = Path(temp) / "next.log"
            if log.exists():
                print("\nProduction server diagnostics:\n" + log.read_text(encoding="utf-8", errors="replace")[-16000:], file=sys.stderr)
            raise
        finally:
            smoke.close()
    print("Wi-Fi HTTP smoke test passed with an injected classifier; real model accuracy was not tested.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
