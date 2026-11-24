"""Authenticated ESP32 receiver with a durable result queue."""
import hashlib
import hmac
import json
import logging
import math
import os
import re
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request

ID = re.compile(r"^[1-9][0-9]{0,15}$")
NODE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,40}$")
AUDIO_BYTES = 88200
THRESHOLD = 0.70
GPS_UTC = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$")
MIN_GPS_EPOCH = 1767225600.0  # 2026-01-01T00:00:00Z
MAX_GPS_EPOCH = 4102444800.0  # 2100-01-01T00:00:00Z
CLOCK_SYNC_MIN_STEP_SECONDS = 5.0

class Invalid(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def gps(fix, lat=None, lng=None):
    if type(fix) is not bool:
        raise Invalid('gps_fix must be true or false')
    if not fix:
        return {'fix': False}
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lng)):
        raise Invalid('invalid GPS coordinates')
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise Invalid('invalid GPS coordinates')
    return {'fix': True, 'latitude': lat, 'longitude': lng}


def header_gps(headers):
    flag = headers.get('X-GPS-Fix', '').lower()
    if flag not in ('true', 'false', '1', '0'):
        raise Invalid('invalid X-GPS-Fix')
    if flag in ('false', '0'):
        return gps(False)
    try:
        return gps(True, float(headers.get('X-GPS-Lat', '')), float(headers.get('X-GPS-Lng', '')))
    except ValueError:
        raise Invalid('invalid GPS coordinates') from None


def capture_timing(headers, clock_id):
    def microseconds(name, maximum):
        value = headers.get(name, '')
        if not re.fullmatch(r'[0-9]{1,16}', value) or int(value) > maximum:
            raise Invalid(f'invalid {name}')
        return int(value)

    local_header = 'X-Audio-Start-Us'
    clock_header = 'X-Audio-Pi-Clock-Id'
    sync_fields = (
        ('X-Audio-Pi-Start-Us', 'pi_first_sample_us', 9007199254740991),
        ('X-Audio-Sync-Rtt-Us', 'round_trip_us', 100000),
        ('X-Audio-Sync-Age-Us', 'sync_age_us', 15000000),
    )
    has_sync = clock_header in headers or any(name in headers for name, _, _ in sync_fields)
    if not has_sync and local_header not in headers:
        return None

    result = {'first_sample_us': microseconds(local_header, 9007199254740991)}
    if has_sync:
        supplied_clock = headers.get(clock_header, '')
        if not re.fullmatch(r'[0-9a-f]{32}', supplied_clock):
            raise Invalid(f'invalid {clock_header}')
        sync = {key: microseconds(name, maximum) for name, key, maximum in sync_fields}
        if supplied_clock == clock_id:
            result.update(clock_id=clock_id, **sync)
    return result


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def parse_gps_utc(value):
    if not isinstance(value, str):
        return None
    match = GPS_UTC.fullmatch(value.strip())
    if not match:
        return None
    year, month, day, hour, minute, second = (int(part) for part in match.groups()[:6])
    micros = int(match.group(7).ljust(6, '0')) if match.group(7) else 0
    try:
        epoch = datetime(year, month, day, hour, minute, second, micros, tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None
    if not (MIN_GPS_EPOCH <= epoch <= MAX_GPS_EPOCH):
        return None
    return epoch


def _default_ntp_synced():
    try:
        result = subprocess.run(
            ['timedatectl', 'show', '-p', 'NTPSynchronized', '--value'],
            capture_output=True, text=True, timeout=2, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip().lower() == 'yes'


def _default_clock_set(epoch):
    time.clock_settime(time.CLOCK_REALTIME, epoch)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Receiver:
    def __init__(self, config, classifier):
        self.registry = config['nodes']
        if not self.registry or any(not NODE_ID.fullmatch(alias) or not NODE_ID.fullmatch(v['id']) or len(v['token']) < 32 for alias, v in self.registry.items()):
            raise ValueError('Invalid node registry')
        if len({v['token'] for v in self.registry.values()}) != len(self.registry):
            raise ValueError('Each node requires a distinct token')
        if len({v['id'] for v in self.registry.values()}) != len(self.registry):
            raise ValueError('Each alias requires a distinct canonical ID')
        self.url = config['url']
        parsed = urllib.parse.urlsplit(self.url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', '::1', 'localhost') or parsed.username or parsed.password or parsed.fragment:
            raise ValueError('Ingestion URL must be loopback HTTP')
        self.token = config['ingest_token']
        if len(self.token) < 32 or any(self.token == node['token'] for node in self.registry.values()):
            raise ValueError('Ingestion token must be at least 32 characters')
        self.capacity = int(config.get('capacity', 100000))
        self.retention = int(config.get('receipt_seconds', 7 * 86400))
        if self.capacity < 1 or self.retention < 1:
            raise ValueError('Invalid queue limits')
        raw_threshold = config.get('threshold', THRESHOLD)
        if isinstance(raw_threshold, bool) or not isinstance(raw_threshold, (int, float)):
            raise ValueError('Invalid detection threshold')
        self.threshold = float(raw_threshold)
        if not math.isfinite(self.threshold) or not 0 < self.threshold <= 1:
            raise ValueError('Invalid detection threshold')
        self.classifier = classifier
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        path = Path(config['database'])
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA max_page_count=65536')
        self.db.execute('PRAGMA journal_size_limit=4194304')
        self.db.execute('PRAGMA wal_autocheckpoint=256')
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version > 1:
            self.db.close()
            raise ValueError('Receiver spool was created by a newer version')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (node_id TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL,
          envelope TEXT NOT NULL, delivered_at INTEGER, rejected_status INTEGER, PRIMARY KEY(node_id,event_id));
        CREATE INDEX IF NOT EXISTS pending ON events(delivered_at);
        CREATE TABLE IF NOT EXISTS node_counters (node_id TEXT PRIMARY KEY, high_water INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audio_timing (
          node_id TEXT NOT NULL, event_id TEXT NOT NULL, timing TEXT NOT NULL,
          PRIMARY KEY(node_id,event_id),
          FOREIGN KEY(node_id,event_id) REFERENCES events(node_id,event_id) ON DELETE CASCADE);
        PRAGMA user_version=1;''')
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('receiver_id', ?)", (str(uuid.uuid4()),))
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('sequence', '0')")
        self.receiver_id = self.db.execute("SELECT value FROM meta WHERE key='receiver_id'").fetchone()[0]
        self.clock_id = uuid.uuid4().hex
        self.worker = None
        self.gps_clock_sync = bool(config.get('gps_clock_sync', False))
        self._clock_now = config.get('clock_now', time.time)
        self._clock_set = config.get('clock_set', _default_clock_set)
        self._ntp_synced = config.get('ntp_synced', _default_ntp_synced)
        self._clock_sync_failed = False

    def authenticate(self, alias, auth):
        node = self.registry.get(alias) if isinstance(alias, str) else None
        supplied = auth[7:] if auth.startswith('Bearer ') else ''
        expected = node['token'] if node else '0' * 32
        valid = hmac.compare_digest(expected.encode(), supplied.encode())
        if not node or not valid:
            raise Invalid('unauthorized', 401)
        return node['id']

    def _maybe_sync_clock(self, node, gps_utc):
        if not self.gps_clock_sync or not gps_utc:
            return False
        gps_epoch = parse_gps_utc(gps_utc)
        if gps_epoch is None:
            return False
        delta = gps_epoch - self._clock_now()
        if delta < CLOCK_SYNC_MIN_STEP_SECONDS:
            if delta <= -60.0:
                logging.warning('Pi clock is %.1fs ahead of node %s GPS UTC (%s); refusing backward step', -delta, node, gps_utc)
            return False
        if self._clock_sync_failed:
            return False
        if self._ntp_synced():
            logging.warning('Skipping GPS clock step of +%.1fs because NTP reports synchronized', delta)
            return False
        try:
            self._clock_set(gps_epoch)
        except (AttributeError, PermissionError, OSError) as exc:
            self._clock_sync_failed = True
            logging.warning('Unable to adjust Pi clock from GPS UTC (%s); add AmbientCapabilities=CAP_SYS_TIME to forest-receiver.service', type(exc).__name__)
            return False
        logging.info('Adjusted Pi clock forward by %.1fs from node %s GPS UTC (%s)', delta, node, gps_utc)
        return True

    def _check_admission(self, node, event_id, digest, now):
        row = self.db.execute('SELECT digest,envelope FROM events WHERE node_id=? AND event_id=?', (node, event_id)).fetchone()
        if row:
            if not hmac.compare_digest(row[0], digest):
                raise Invalid('event ID reused with different content', 409)
            return json.loads(row[1])
        watermark = self.db.execute('SELECT high_water FROM node_counters WHERE node_id=?', (node,)).fetchone()
        if watermark and int(event_id) <= watermark[0]:
            raise Invalid('expired or out-of-order event counter', 409)
        self.db.execute('DELETE FROM events WHERE delivered_at IS NOT NULL AND delivered_at < ?', (now - self.retention * 1000,))
        if self.db.execute('SELECT COUNT(*) FROM events').fetchone()[0] >= self.capacity:
            raise Invalid('receiver queue full', 503)
        return None

    def _commit_event(self, node, event_id, digest, now, position, kind, classification, timing=None):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            seq = int(self.db.execute("SELECT value FROM meta WHERE key='sequence'").fetchone()[0]) + 1
            if seq > 9007199254740991:
                raise RuntimeError('receiver sequence exhausted')
            envelope = {'version': 1, 'receiver_id': self.receiver_id, 'sequence': seq, 'event_id': event_id,
                'node_id': node, 'received_at': now, 'gps': position, 'kind': kind}
            if classification is not None:
                envelope['classification'] = classification
            self.db.execute("UPDATE meta SET value=? WHERE key='sequence'", (str(seq),))
            self.db.execute('INSERT INTO node_counters VALUES (?,?) ON CONFLICT(node_id) DO UPDATE SET high_water=excluded.high_water', (node, int(event_id)))
            self.db.execute('INSERT INTO events(node_id,event_id,digest,envelope) VALUES (?,?,?,?)', (node, event_id, digest, canonical(envelope)))
            if timing is not None:
                self.db.execute('INSERT INTO audio_timing(node_id,event_id,timing) VALUES (?,?,?)',
                                (node, event_id, canonical(timing)))
            self.db.execute('COMMIT')
            return envelope
        except BaseException:
            try:
                self.db.execute('ROLLBACK')
            except sqlite3.Error:
                pass  # SQLite can automatically roll back on a full disk.
            raise

    def accept(self, node, event_id, kind, position, audio=None, gps_utc=None, timing=None):
        if not isinstance(event_id, str) or not ID.fullmatch(event_id) or int(event_id) > 9007199254740991:
            raise Invalid('X-Event-ID must be a positive decimal counter')
        raw_digest = hashlib.sha256(audio or b'').hexdigest()
        digest = hashlib.sha256(canonical({'kind': kind, 'gps': position, 'audio_sha256': raw_digest}).encode()).hexdigest()
        with self.lock:
            self._maybe_sync_clock(node, gps_utc)
            now = int(self._clock_now() * 1000)
            existing = self._check_admission(node, event_id, digest, now)
            if existing is not None:
                return existing
            if kind != 'audio':
                envelope = self._commit_event(node, event_id, digest, now, position, kind, None)
                self.wake.set()
                return envelope
        try:
            probability, model_hash = self.classifier(audio)
            probability = float(probability)
            if not math.isfinite(probability) or not 0 <= probability <= 1 or not re.fullmatch(r'[0-9a-f]{64}', model_hash):
                raise ValueError('invalid classifier output')
            classification = {'probability': probability, 'threshold': self.threshold, 'detected': probability >= self.threshold, 'model_sha256': model_hash}
        except Exception as exc:
            logging.warning('Classifier unavailable (%s)', type(exc).__name__)
            raise Invalid('classifier unavailable', 503) from exc
        with self.lock:
            existing = self._check_admission(node, event_id, digest, now)
            if existing is not None:
                return existing
            envelope = self._commit_event(node, event_id, digest, now, position, kind, classification, timing)
        self.wake.set()
        return envelope

    def forward_once(self):
        node = event_id = None
        try:
            with self.lock:
                row = self.db.execute('SELECT node_id,event_id,envelope FROM events WHERE delivered_at IS NULL AND rejected_status IS NULL ORDER BY rowid LIMIT 1').fetchone()
            if not row:
                return False
            node, event_id, envelope = row
            req = urllib.request.Request(self.url, data=envelope.encode(), headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'}, method='POST')
            try:
                with self.opener.open(req, timeout=5) as response:
                    if response.status not in (200, 201):
                        raise ValueError('unexpected status')
                    data = json.loads(response.read(16385))
                    if not isinstance(data, dict) or data.get('accepted') is not True or data.get('node_id') != node or data.get('event_id') != event_id:
                        raise ValueError('invalid acknowledgement')
            except urllib.error.HTTPError as exc:
                if exc.code in (400, 409):
                    with self.lock:
                        self.db.execute('UPDATE events SET rejected_status=? WHERE node_id=? AND event_id=?', (exc.code, node, event_id))
                    logging.error('Quarantined receiver event %s/%s after app HTTP %s; operator action required', node, event_id, exc.code)
                    return True
                raise
            with self.lock:
                self.db.execute('UPDATE events SET delivered_at=? WHERE node_id=? AND event_id=?', (int(time.time() * 1000), node, event_id))
            return True
        except (OSError, ValueError, urllib.error.URLError, sqlite3.Error) as exc:
            logging.warning('Forwarding failed for %s/%s (%s); retrying', node, event_id, type(exc).__name__)
            return False

    def start(self):
        def run():
            delay = 1
            while not self.stop.is_set():
                if self.forward_once():
                    delay = 1
                    continue
                self.wake.wait(delay)
                self.wake.clear()
                delay = min(delay * 2, 60)
        self.worker = threading.Thread(target=run, name='forwarder')
        self.worker.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.worker:
            self.worker.join()
        with self.lock:
            self.db.close()


def create_app(receiver):
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = AUDIO_BYTES

    @app.errorhandler(Invalid)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    @app.errorhandler(sqlite3.Error)
    def storage_error(error):
        app.logger.error('Receiver storage unavailable: %s', type(error).__name__)
        return jsonify(error='receiver storage unavailable'), 503

    @app.get('/clock')
    def clock():
        received_us = time.monotonic_ns() // 1000
        receiver.authenticate(request.headers.get('X-Node-ID'), request.headers.get('Authorization', ''))
        response = app.response_class(status=204, headers={
            'Cache-Control': 'no-store',
            'X-Pi-Clock-Id': receiver.clock_id,
            'X-Pi-Receive-Us': str(received_us),
        })
        response.headers['X-Pi-Send-Us'] = str(time.monotonic_ns() // 1000)
        return response

    @app.post('/location')
    def location():
        # Node ID is in the bounded body for the existing location protocol.
        if request.content_length is None or request.content_length == 0:
            raise Invalid('location body required')
        if request.content_length > 4096:
            raise Invalid('location body too large', 413)
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise Invalid('invalid JSON')
        node = receiver.authenticate(data.get('node_id'), request.headers.get('Authorization', ''))
        if set(data) - {'node_id', 'gps_fix', 'latitude', 'longitude', 'event_id'}:
            raise Invalid('unexpected location field')
        header_id, body_id = request.headers.get('X-Event-ID'), data.get('event_id')
        if header_id is not None and body_id is not None and header_id != body_id:
            raise Invalid('conflicting event IDs')
        event_id = header_id if header_id is not None else body_id
        result = receiver.accept(node, event_id, 'location', gps(data.get('gps_fix'), data.get('latitude'), data.get('longitude')), gps_utc=request.headers.get('X-GPS-UTC'))
        return jsonify(accepted=True, event_id=result['event_id']), 200

    @app.post('/upload')
    def upload():
        node = receiver.authenticate(request.headers.get('X-Node-ID'), request.headers.get('Authorization', ''))
        if request.headers.get('X-Sample-Rate', '22050') != '22050':
            raise Invalid('expected sample rate 22050')
        position = header_gps(request.headers)
        timing = capture_timing(request.headers, receiver.clock_id)
        event_id = request.headers.get('X-Event-ID')
        if request.content_length != AUDIO_BYTES:
            raise Invalid('audio must contain exactly 88200 bytes')
        audio = request.get_data(cache=False)
        if len(audio) != AUDIO_BYTES:
            raise Invalid('audio must contain exactly 88200 bytes')
        result = receiver.accept(node, event_id, 'audio', position, audio,
                                 gps_utc=request.headers.get('X-GPS-UTC'), timing=timing)
        c = result['classification']
        return jsonify(status='success', accepted=True, event_id=result['event_id'], node_id=node,
                       chainsaw_probability=c['probability'],
                       confidence=round(c['probability'] * 100, 2),
                       result='CHAINSAW DETECTED' if c['detected'] else 'NOT CHAINSAW', **c), 200

    return app
