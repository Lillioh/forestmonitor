import json
import tempfile
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import unittest
from pathlib import Path
from receiver import Receiver, create_app, AUDIO_BYTES, THRESHOLD, NoRedirect

TOKEN = 'a' * 32
INGEST = 'z' * 32
MODEL = 'b' * 64

class ReceiverTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = {'nodes': {'node_A': {'id': 'NODE-01', 'token': TOKEN}}, 'url': 'http://127.0.0.1:3000/api/ingest', 'ingest_token': INGEST, 'database': str(Path(self.tmp.name) / 'spool.sqlite'), 'capacity': 3}
        self.calls = 0
        self.r = Receiver(self.config, self.classify)
        self.app = create_app(self.r).test_client()
        self.auth = {'Authorization': 'Bearer ' + TOKEN, 'X-Event-ID': '1'}

    def classify(self, audio):
        self.calls += 1
        return 0.95, MODEL

    def tearDown(self):
        self.r.close()
        self.tmp.cleanup()

    def location(self, event='1', fix=True, latitude=8.4):
        headers = {**self.auth, 'X-Event-ID': event}
        return self.app.post('/location', headers=headers, json={'node_id': 'node_A', 'gps_fix': fix, 'latitude': latitude, 'longitude': 124.7})

    def test_future_spool_schema_is_refused(self):
        self.r.db.execute('PRAGMA user_version=2')
        with self.assertRaises(ValueError):
            Receiver(self.config, self.classify)

    def test_auth_validation_and_conflict(self):
        self.assertEqual(self.app.post('/location', json={'node_id': 'node_A', 'gps_fix': False}).status_code, 401)
        self.assertEqual(self.location(latitude=True).status_code, 400)
        for event in ('0', '01', '-1', '9' * 17):
            self.assertEqual(self.location(event).status_code, 400)
        self.assertEqual(self.app.post('/location', headers=self.auth, data=b'').status_code, 400)
        self.assertEqual(self.app.post('/location', headers=self.auth, json={'node_id':'node_A','gps_fix':'false'}).status_code, 400)
        bad = self.app.post('/location', headers=self.auth, json={'node_id':'node_A','gps_fix':False,'event_id':'different'})
        self.assertEqual(bad.status_code, 400)
        bad = self.app.post('/location', headers=self.auth, json={'node_id':'node_A','gps_fix':False,'extra':123})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.location().status_code, 200)
        self.assertEqual(self.location().status_code, 200)
        self.assertEqual(self.location(latitude=8.5).status_code, 409)
        self.assertEqual(self.r.db.execute('SELECT count(*) FROM events').fetchone()[0], 1)

    def test_provision_preserves_blank_settings_and_refuses_existing_token(self):
        base = Path(self.tmp.name)
        env = base / '.env.local'
        env.write_text('UNCHANGED=value\n# FOREST_INGEST_TOKEN=old\nFOREST_INGEST_TOKEN=\n', encoding='utf-8')
        script = Path(__file__).resolve().parents[1] / 'provision.py'
        args = [sys.executable, str(script), '--app-env', str(env), '--nodes', str(base / 'nodes.json'), '--receiver-env', str(base / 'receiver.env'), '--node', 'node_A=NODE-01']
        self.assertEqual(subprocess.run(args, capture_output=True).returncode, 0)
        content = env.read_text(encoding='utf-8')
        self.assertIn('UNCHANGED=value', content)
        self.assertEqual(content.count('FOREST_INGEST_TOKEN='), 3)
        args[args.index(str(base / 'nodes.json'))] = str(base / 'nodes2.json')
        args[args.index(str(base / 'receiver.env'))] = str(base / 'receiver2.env')
        self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)
        self.assertEqual(env.read_text(encoding='utf-8'), content)

    def test_audio_durable_and_duplicate_across_restart(self):
        headers = {**self.auth, 'X-Node-ID': 'node_A', 'X-GPS-Fix': '0'}
        response = self.app.post('/upload', headers=headers, data=bytes(AUDIO_BYTES))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['detected'])
        self.assertEqual(response.json['chainsaw_probability'], 0.95)
        original = self.r.db.execute('SELECT envelope FROM events').fetchone()[0]
        self.r.close()
        self.r = Receiver(self.config, self.classify)
        self.app = create_app(self.r).test_client()
        self.assertEqual(self.app.post('/upload', headers=headers, data=bytes(AUDIO_BYTES)).status_code, 200)
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.r.db.execute('SELECT envelope FROM events').fetchone()[0], original)
        self.assertEqual(self.app.post('/upload', headers=headers, data=b'bad').status_code, 400)
        self.assertEqual(self.r.db.execute('SELECT count(*) FROM events WHERE delivered_at IS NULL').fetchone()[0], 1)

    def test_clock_reports_an_authenticated_monotonic_exchange(self):
        self.assertEqual(self.app.get('/clock', headers={'X-Node-ID': 'node_A'}).status_code, 401)
        headers = {**self.auth, 'X-Node-ID': 'node_A'}
        before = time.monotonic_ns() // 1000
        reply = self.app.get('/clock', headers=headers)
        after = time.monotonic_ns() // 1000
        self.assertEqual(reply.status_code, 204)
        self.assertEqual(reply.data, b'')
        self.assertEqual(reply.headers['Cache-Control'], 'no-store')
        self.assertRegex(reply.headers['X-Pi-Clock-Id'], r'^[0-9a-f]{32}$')
        received = int(reply.headers['X-Pi-Receive-Us'])
        sent = int(reply.headers['X-Pi-Send-Us'])
        self.assertTrue(before <= received <= sent <= after)
        self.assertEqual(self.r.db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)

    def test_capture_timing_is_local_and_survives_retry_and_restart(self):
        headers = {**self.auth, 'X-Node-ID': 'node_A', 'X-GPS-Fix': '0', 'X-Audio-Start-Us': '10000'}
        clock_id = self.app.get('/clock', headers=headers).headers['X-Pi-Clock-Id']
        timing_headers = {
            **headers, 'X-Audio-Pi-Clock-Id': clock_id, 'X-Audio-Pi-Start-Us': '12345678',
            'X-Audio-Sync-Rtt-Us': '4000', 'X-Audio-Sync-Age-Us': '20000',
        }
        audio = bytes(AUDIO_BYTES)
        incomplete = {key: value for key, value in timing_headers.items() if key != 'X-Audio-Sync-Rtt-Us'}
        self.assertEqual(self.app.post('/upload', headers=incomplete, data=audio).status_code, 400)
        self.assertEqual(self.app.post('/upload', headers=timing_headers, data=audio).status_code, 200)
        envelope = json.loads(self.r.db.execute('SELECT envelope FROM events').fetchone()[0])
        self.assertEqual(set(envelope), {'version', 'receiver_id', 'sequence', 'event_id', 'node_id',
                                        'received_at', 'gps', 'kind', 'classification'})

        self.r.close()
        self.r = Receiver(self.config, self.classify)
        self.app = create_app(self.r).test_client()
        self.assertNotEqual(self.app.get('/clock', headers=headers).headers['X-Pi-Clock-Id'], clock_id)
        self.assertEqual(self.app.post('/upload', headers=timing_headers, data=audio).status_code, 200)
        self.assertEqual(self.calls, 1)

        after_restart = {**timing_headers, 'X-Event-ID': '2', 'X-Audio-Start-Us': '30000'}
        self.assertEqual(self.app.post('/upload', headers=after_restart, data=audio).status_code, 200)
        rows = self.r.db.execute('SELECT timing FROM audio_timing ORDER BY event_id').fetchall()
        self.assertEqual([json.loads(row[0]) for row in rows], [
            {'first_sample_us': 10000, 'clock_id': clock_id, 'pi_first_sample_us': 12345678,
             'round_trip_us': 4000, 'sync_age_us': 20000},
            {'first_sample_us': 30000},
        ])

    def test_no_false_ack_backpressure_and_classifier_failure(self):
        self.assertEqual(self.location('1').status_code, 200)
        self.assertEqual(self.location('2', fix=False).status_code, 200)
        self.assertEqual(self.location('3').status_code, 200)
        self.assertEqual(self.location('4').status_code, 503)
        self.assertFalse(self.r.forward_once())
        self.assertEqual(self.r.db.execute('SELECT count(*) FROM events WHERE delivered_at IS NULL').fetchone()[0], 3)

    def test_disk_full_rolls_back_and_does_not_ack(self):
        db = self.r.db
        class FullDisk:
            def execute(self, statement, *args):
                if statement.startswith('INSERT INTO events'):
                    raise sqlite3.OperationalError('database or disk is full')
                return db.execute(statement, *args)
            def close(self): db.close()
        self.r.db = FullDisk()
        self.assertEqual(self.location().status_code, 503)
        self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT value FROM meta WHERE key='sequence'").fetchone()[0], '0')

    def test_http_error_and_redirect_never_acknowledge(self):
        self.location()
        class Opener:
            def open(self, *args, **kwargs):
                raise urllib.error.HTTPError('http://127.0.0.1', 503, 'down', {}, None)
        self.r.opener = Opener()
        self.assertFalse(self.r.forward_once())
        self.assertIsNone(self.r.db.execute('SELECT delivered_at FROM events').fetchone()[0])
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'http://other'))

    def test_expired_replay_cannot_reset_counter(self):
        self.assertEqual(self.location('1').status_code, 200)
        self.r.db.execute("UPDATE events SET delivered_at=1 WHERE event_id='1'")
        self.assertEqual(self.location('2').status_code, 200)  # prunes expired receipt
        self.assertEqual(self.location('1').status_code, 409)
        self.r.close()
        self.r = Receiver(self.config, self.classify)
        self.app = create_app(self.r).test_client()
        self.assertEqual(self.location('1').status_code, 409)
        self.assertEqual(self.location('3').status_code, 200)

    def test_malformed_ack_and_transient_db_failure(self):
        self.location()
        class Response:
            status = 200
            def __init__(self, data): self.data = data
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return self.data
        class Opener:
            def __init__(self, data): self.data = data
            def open(self, *args, **kwargs): return Response(self.data)
        for body in (b'[]', b'null', b'"text"'):
            self.r.opener = Opener(body)
            self.assertFalse(self.r.forward_once())
        db = self.r.db
        class FailingDb:
            fail = True
            def execute(self, sql, *args):
                if self.fail:
                    self.fail = False
                    raise sqlite3.OperationalError('temporary')
                return db.execute(sql, *args)
            def close(self): db.close()
        self.r.db = FailingDb()
        self.assertFalse(self.r.forward_once())
        self.r.opener = Opener(b'{"accepted":true,"node_id":"NODE-01","event_id":"1"}')
        self.assertTrue(self.r.forward_once())

    def test_ack_write_failure_is_retried(self):
        self.location()
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return b'{"accepted":true,"node_id":"NODE-01","event_id":"1"}'
        class Opener:
            def open(self, *args, **kwargs): return Response()
        db = self.r.db
        class FailingDb:
            fail = True
            def execute(self, sql, *args):
                if sql.startswith('UPDATE events SET delivered_at') and self.fail:
                    self.fail = False
                    raise sqlite3.OperationalError('temporary')
                return db.execute(sql, *args)
            def close(self): db.close()
        self.r.db = FailingDb()
        self.r.opener = Opener()
        self.assertFalse(self.r.forward_once())
        self.assertIsNone(db.execute('SELECT delivered_at FROM events').fetchone()[0])
        self.assertTrue(self.r.forward_once())
        self.assertIsNotNone(db.execute('SELECT delivered_at FROM events').fetchone()[0])

    def test_provision_failure_removes_only_new_credentials(self):
        base = Path(self.tmp.name)
        env = base / '.env.local'
        env.write_text('UNCHANGED=value\n', encoding='utf-8')
        script = Path(__file__).resolve().parents[1] / 'provision.py'
        args = [str(script), '--app-env', str(env), '--nodes', str(base / 'nodes.json'), '--receiver-env', str(base / 'receiver.env'), '--node', 'node_A=NODE-01']
        code = "import runpy,sys,os; from unittest.mock import patch; sys.argv=sys.argv[1:]; p=patch.object(os,'replace',side_effect=OSError('forced')); p.start(); runpy.run_path(sys.argv[0],run_name='__main__')"
        self.assertNotEqual(subprocess.run([sys.executable, '-c', code, *args], capture_output=True).returncode, 0)
        self.assertEqual(env.read_text(encoding='utf-8'), 'UNCHANGED=value\n')
        self.assertFalse((base / 'nodes.json').exists())
        self.assertFalse((base / 'receiver.env').exists())
        self.assertEqual(subprocess.run([sys.executable, *args], capture_output=True).returncode, 0)

    def test_poison_record_does_not_block_next(self):
        self.assertEqual(self.location('1').status_code, 200)
        self.assertEqual(self.location('2').status_code, 200)
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return b'{"accepted":true,"node_id":"NODE-01","event_id":"2"}'
        class Opener:
            calls = 0
            def open(self, *args, **kwargs):
                self.calls += 1
                if self.calls == 1: raise urllib.error.HTTPError('http://127.0.0.1', 409, 'conflict', {}, None)
                return Response()
        self.r.opener = Opener()
        self.assertTrue(self.r.forward_once())
        self.assertTrue(self.r.forward_once())
        rows = self.r.db.execute('SELECT rejected_status,delivered_at FROM events ORDER BY rowid').fetchall()
        self.assertEqual(rows[0][0], 409)
        self.assertIsNone(rows[0][1])
        self.assertIsNotNone(rows[1][1])

    def test_shutdown_waits_for_inflight_request(self):
        from main import Admission
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        def slow(environ, start):
            entered.set()
            release.wait(5)
            start('200 OK', [])
            return [b'ok']
        app = Admission(slow)
        handler = threading.Thread(target=lambda: list(app({}, lambda *args: None)))
        handler.start()
        self.assertTrue(entered.wait(2))
        drain = threading.Thread(target=lambda: (app.drain(), finished.set()))
        drain.start()
        time.sleep(0.05)
        self.assertFalse(finished.is_set())
        release.set()
        handler.join(2)
        drain.join(2)
        self.assertTrue(finished.is_set())

    def test_unavailable_classifier(self):
        def fail(_): raise FileNotFoundError('model absent')
        self.r.classifier = fail
        headers = {**self.auth, 'X-Node-ID': 'node_A', 'X-GPS-Fix': '0'}
        self.assertEqual(self.app.post('/upload', headers=headers, data=bytes(AUDIO_BYTES)).status_code, 503)
        self.assertEqual(self.r.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
        self.assertEqual(self.location(fix=False).status_code, 200)

    def test_matching_ack_required_and_redirect_forbidden(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, n): return json.dumps({'accepted': True, 'node_id': 'other', 'event_id': '1'}).encode()
        class Opener:
            def open(self, *args, **kwargs): return Response()
        self.location()
        self.r.opener = Opener()
        self.assertFalse(self.r.forward_once())
        self.assertIsNone(self.r.db.execute('SELECT delivered_at FROM events').fetchone()[0])
        Response.read = lambda self, n: json.dumps({'accepted': True, 'node_id': 'NODE-01', 'event_id': '1'}).encode()
        self.assertTrue(self.r.forward_once())
        self.assertIsNotNone(self.r.db.execute('SELECT delivered_at FROM events').fetchone()[0])
        with self.assertRaises(ValueError):
            Receiver({**self.config, 'url': 'http://example.com/api/ingest'}, self.classify)

    def test_waitress_body_limit_accepts_audio_and_rejects_oversize(self):
        from main import MAX_REQUEST_BODY_SIZE, SERVER_OPTIONS
        from waitress.adjustments import Adjustments
        from waitress.parser import HTTPRequestParser

        self.assertEqual(SERVER_OPTIONS['max_request_body_size'], AUDIO_BYTES + 1)
        self.assertEqual(MAX_REQUEST_BODY_SIZE, AUDIO_BYTES + 1)
        adjustments = Adjustments(**SERVER_OPTIONS)

        payload = (
            f'POST /upload HTTP/1.1\r\nHost: 10.42.0.1:5000\r\nContent-Length: {AUDIO_BYTES}\r\n\r\n'.encode()
            + bytes(AUDIO_BYTES)
        )
        parser = HTTPRequestParser(adjustments)
        offset = 0
        while offset < len(payload) and not parser.completed:
            consumed = parser.received(payload[offset:])
            self.assertGreater(consumed, 0)
            offset += consumed
        self.assertIsNone(parser.error)
        self.assertTrue(parser.completed)
        self.assertEqual(parser.body_bytes_received, AUDIO_BYTES)

        oversize = f'POST /upload HTTP/1.1\r\nHost: 10.42.0.1:5000\r\nContent-Length: {AUDIO_BYTES + 1}\r\n\r\n'.encode()
        oversize_parser = HTTPRequestParser(adjustments)
        oversize_parser.received(oversize)
        self.assertIsNotNone(oversize_parser.error)
        self.assertEqual(oversize_parser.error.code, 413)

    def test_detection_threshold_and_configurable_sensitivity(self):
        self.assertEqual(THRESHOLD, 0.70)
        self.r.close()
        self.r = Receiver({**self.config, 'capacity': 10}, self.classify)
        self.app = create_app(self.r).test_client()
        cases = [
            ('1', 0.63, False, 'NOT CHAINSAW'),
            ('2', 0.699, False, 'NOT CHAINSAW'),
            ('3', 0.70, True, 'CHAINSAW DETECTED'),
            ('4', 0.878, True, 'CHAINSAW DETECTED'),
        ]
        for event_id, score, expected_detected, expected_result in cases:
            self.r.classifier = lambda _, s=score: (s, MODEL)
            headers = {**self.auth, 'X-Event-ID': event_id, 'X-Node-ID': 'node_A', 'X-GPS-Fix': '0'}
            response = self.app.post('/upload', headers=headers, data=bytes(AUDIO_BYTES))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['threshold'], 0.70)
            self.assertEqual(response.json['detected'], expected_detected)
            self.assertEqual(response.json['result'], expected_result)

        for bad_threshold in (0.0, -0.5, 1.01, float('nan'), True):
            with self.assertRaises(ValueError):
                Receiver({**self.config, 'database': str(Path(self.tmp.name) / 'bad-thresh.sqlite'), 'threshold': bad_threshold}, self.classify)

    def test_classifier_feature_extraction_removes_dc_and_normalizes_quiet_signals(self):
        import numpy as np
        from classifier import extract_features

        rng = np.random.default_rng(42)
        t = np.linspace(0, 2.0, 44100, endpoint=False, dtype=np.float32)
        harmonic = (
            0.6 * np.sin(2 * np.pi * 120 * t)
            + 0.3 * np.sin(2 * np.pi * 240 * t)
            + 0.2 * np.sin(2 * np.pi * 480 * t)
            + 0.05 * rng.normal(0, 1, len(t))
        ).astype(np.float32)
        harmonic /= np.max(np.abs(harmonic))

        loud_pcm = np.clip(harmonic * 20000.0, -32768, 32767).astype('<i2').tobytes()
        quiet_dc_pcm = np.clip(harmonic * 400.0 - 1500.0, -32768, 32767).astype('<i2').tobytes()

        loud_features = extract_features(loud_pcm)
        quiet_dc_features = extract_features(quiet_dc_pcm)

        self.assertEqual(loud_features.shape, (1, 128, 87, 1))
        self.assertEqual(loud_features.dtype, np.float32)
        self.assertLess(float(np.mean(np.abs(loud_features - quiet_dc_features))), 0.01)
        self.assertLess(float(np.max(np.abs(loud_features - quiet_dc_features))), 0.05)

    def test_audio_classification_does_not_block_concurrent_location_heartbeats(self):
        entered = threading.Event()
        release = threading.Event()
        location_done = threading.Event()
        results = {}

        def slow_classify(_):
            entered.set()
            release.wait(3)
            return 0.85, MODEL

        cfg = {
            **self.config,
            'database': str(Path(self.tmp.name) / 'concurrent.sqlite'),
            'capacity': 10,
            'nodes': {
                'node_A': {'id': 'NODE-01', 'token': TOKEN},
                'node_B': {'id': 'NODE-02', 'token': 'c' * 32},
            },
        }
        r = Receiver(cfg, slow_classify)
        try:
            def run_audio():
                results['audio'] = r.accept('NODE-01', '1', 'audio', {'fix': False}, bytes(AUDIO_BYTES))

            def run_location():
                results['location'] = r.accept('NODE-02', '1', 'location', {'fix': True, 'latitude': 8.53, 'longitude': 124.31})
                location_done.set()

            audio_thread = threading.Thread(target=run_audio)
            audio_thread.start()
            self.assertTrue(entered.wait(2))

            loc_thread = threading.Thread(target=run_location)
            loc_thread.start()
            self.assertTrue(location_done.wait(1), 'Location heartbeat should not block on slow audio inference')

            release.set()
            audio_thread.join(2)
            loc_thread.join(2)
            self.assertTrue(results['audio']['classification']['detected'])
            self.assertEqual(results['location']['node_id'], 'NODE-02')
        finally:
            release.set()
            r.close()

    def test_gps_utc_adjusts_behind_clock_and_stamps_event(self):
        from datetime import datetime, timezone

        current = [datetime(2026, 11, 20, 18, 35, 0, tzinfo=timezone.utc).timestamp()]
        calls = []

        def clock_set(epoch):
            calls.append(epoch)
            current[0] = epoch

        cfg = {
            **self.config,
            'database': str(Path(self.tmp.name) / 'gps-clock.sqlite'),
            'capacity': 10,
            'gps_clock_sync': True,
            'clock_now': lambda: current[0],
            'clock_set': clock_set,
            'ntp_synced': lambda: False,
        }
        r = Receiver(cfg, self.classify)
        try:
            app = create_app(r).test_client()
            utc_header = '2026-11-22T18:35:00.250Z'
            expected_epoch = datetime(2026, 11, 22, 18, 35, 0, 250000, tzinfo=timezone.utc).timestamp()

            unauth = app.post('/location', headers={'X-Event-ID': '1', 'X-GPS-UTC': utc_header},
                              json={'node_id': 'node_A', 'gps_fix': False})
            self.assertEqual(unauth.status_code, 401)
            self.assertEqual(calls, [])

            res1 = app.post('/location', headers={**self.auth, 'X-GPS-UTC': utc_header},
                            json={'node_id': 'node_A', 'gps_fix': True, 'latitude': 8.46, 'longitude': 124.7})
            self.assertEqual(res1.status_code, 200)
            self.assertEqual(calls, [expected_epoch])
            envelope = json.loads(r.db.execute("SELECT envelope FROM events WHERE event_id='1'").fetchone()[0])
            self.assertEqual(envelope['received_at'], int(expected_epoch * 1000))

            res2 = app.post('/location',
                            headers={**self.auth, 'X-Event-ID': '2', 'X-GPS-UTC': '2026-11-22T18:35:01.250Z'},
                            json={'node_id': 'node_A', 'gps_fix': True, 'latitude': 8.46, 'longitude': 124.7})
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(len(calls), 1)

            retry = app.post('/location', headers={**self.auth, 'X-GPS-UTC': '2026-11-22T18:35:02.000Z'},
                             json={'node_id': 'node_A', 'gps_fix': True, 'latitude': 8.46, 'longitude': 124.7})
            self.assertEqual(retry.status_code, 200)
        finally:
            r.close()

    def test_gps_utc_guardrails_ignore_invalid_backward_ntp_and_permission_errors(self):
        from datetime import datetime, timezone

        current = [datetime(2026, 11, 22, 18, 35, 0, tzinfo=timezone.utc).timestamp()]
        ntp_flag = [False]
        fail_permission = [False]
        calls = []
        permission_attempts = [0]

        def clock_set(epoch):
            if fail_permission[0]:
                permission_attempts[0] += 1
                raise PermissionError('CAP_SYS_TIME missing')
            calls.append(epoch)
            current[0] = epoch

        cfg = {
            **self.config,
            'database': str(Path(self.tmp.name) / 'gps-guardrails.sqlite'),
            'capacity': 10,
            'gps_clock_sync': True,
            'clock_now': lambda: current[0],
            'clock_set': clock_set,
            'ntp_synced': lambda: ntp_flag[0],
        }
        r = Receiver(cfg, self.classify)
        try:
            app = create_app(r).test_client()
            for idx, bad_utc in enumerate(('18:35:00:250', '2000-01-01T00:00:10.000Z', '2026-02-30T12:00:00.000Z'), 1):
                res = app.post('/location', headers={**self.auth, 'X-Event-ID': str(idx), 'X-GPS-UTC': bad_utc},
                               json={'node_id': 'node_A', 'gps_fix': False})
                self.assertEqual(res.status_code, 200)
            self.assertEqual(calls, [])

            res_behind = app.post('/location',
                                  headers={**self.auth, 'X-Event-ID': '4', 'X-GPS-UTC': '2026-11-22T16:35:00.000Z'},
                                  json={'node_id': 'node_A', 'gps_fix': False})
            self.assertEqual(res_behind.status_code, 200)
            self.assertEqual(calls, [])

            current[0] = datetime(2026, 11, 20, 18, 35, 0, tzinfo=timezone.utc).timestamp()
            ntp_flag[0] = True
            res_ntp = app.post('/location',
                               headers={**self.auth, 'X-Event-ID': '5', 'X-GPS-UTC': '2026-11-22T18:35:00.000Z'},
                               json={'node_id': 'node_A', 'gps_fix': False})
            self.assertEqual(res_ntp.status_code, 200)
            self.assertEqual(calls, [])

            ntp_flag[0] = False
            fail_permission[0] = True
            res_audio = app.post('/upload',
                                 headers={**self.auth, 'X-Event-ID': '6', 'X-Node-ID': 'node_A', 'X-GPS-Fix': '0',
                                          'X-GPS-UTC': '2026-11-22T18:35:00.000Z'},
                                 data=bytes(AUDIO_BYTES))
            self.assertEqual(res_audio.status_code, 200)
            self.assertEqual(permission_attempts[0], 1)

            res_next = app.post('/location',
                                headers={**self.auth, 'X-Event-ID': '7', 'X-GPS-UTC': '2026-11-22T18:35:10.000Z'},
                                json={'node_id': 'node_A', 'gps_fix': False})
            self.assertEqual(res_next.status_code, 200)
            self.assertEqual(permission_attempts[0], 1)
        finally:
            r.close()

if __name__ == '__main__':
    unittest.main()
