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
from receiver import Receiver, create_app, AUDIO_BYTES, NoRedirect

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
        return 0.75, MODEL

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
        self.assertEqual(response.json['chainsaw_probability'], 0.75)
        original = self.r.db.execute('SELECT envelope FROM events').fetchone()[0]
        self.r.close()
        self.r = Receiver(self.config, self.classify)
        self.app = create_app(self.r).test_client()
        self.assertEqual(self.app.post('/upload', headers=headers, data=bytes(AUDIO_BYTES)).status_code, 200)
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.r.db.execute('SELECT envelope FROM events').fetchone()[0], original)
        self.assertEqual(self.app.post('/upload', headers=headers, data=b'bad').status_code, 400)
        self.assertEqual(self.r.db.execute('SELECT count(*) FROM events WHERE delivered_at IS NULL').fetchone()[0], 1)

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

if __name__ == '__main__':
    unittest.main()
