"""Run under a supervisor; no development server or reloader."""
import json
import os
import signal
import threading
from waitress import create_server
from classifier import Classifier
from receiver import Receiver, create_app


class Admission:
    """Reject new requests while waiting for active WSGI handlers to finish."""
    def __init__(self, app):
        self.app = app
        self.condition = threading.Condition()
        self.active = 0
        self.stopping = False

    def __call__(self, environ, start_response):
        with self.condition:
            if self.stopping:
                start_response('503 Service Unavailable', [('Content-Length', '0')])
                return [b'']
            self.active += 1
        def response():
            result = None
            try:
                result = self.app(environ, start_response)
                yield from result
            finally:
                if hasattr(result, 'close'):
                    result.close()
                with self.condition:
                    self.active -= 1
                    self.condition.notify_all()
        return response()

    def drain(self):
        with self.condition:
            self.stopping = True
            while self.active:
                self.condition.wait()


def main():
    with open(os.environ['RECEIVER_NODES_FILE'], encoding='utf-8') as file:
        nodes = json.load(file)
    config = {'nodes': nodes, 'url': os.environ['WEBSITE_LOCATION_URL'], 'ingest_token': os.environ['WEBSITE_API_TOKEN'],
              'database': os.environ['RECEIVER_DATABASE'], 'capacity': int(os.getenv('RECEIVER_CAPACITY', '100000')),
              'receipt_seconds': int(os.getenv('RECEIVER_RECEIPT_SECONDS', '604800'))}
    receiver = Receiver(config, Classifier(os.environ['RECEIVER_MODEL']))
    app = Admission(create_app(receiver))
    server = create_server(app, host=os.getenv('RECEIVER_HOST', '0.0.0.0'),
                           port=int(os.getenv('RECEIVER_PORT', '5000')), threads=4,
                           connection_limit=32, channel_timeout=15, max_request_body_size=88200)
    def stop(signum, frame):
        server.close()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    receiver.start()
    try:
        server.run()
    finally:
        server.close()
        app.drain()
        receiver.close()

if __name__ == '__main__':
    main()
