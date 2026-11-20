"""Create private credentials once, preserving unrelated app settings."""
import argparse
import json
import os
import re
import secrets
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app-env', default=Path('.env.local'), type=Path)
parser.add_argument('--nodes', default=Path('data/receiver/nodes.json'), type=Path)
parser.add_argument('--receiver-env', default=Path('.env.receiver.local'), type=Path)
parser.add_argument('--node', action='append', required=True, metavar='WIRE_ID=CANONICAL_ID')
args = parser.parse_args()
if args.nodes.exists() or args.receiver_env.exists():
    parser.error('Credentials already exist; refusing to overwrite them')
from receiver import NODE_ID
nodes = {}
for mapping in args.node:
    parts = mapping.split('=')
    if len(parts) != 2 or not all(NODE_ID.fullmatch(p) for p in parts) or parts[0] in nodes or any(n['id'] == parts[1] for n in nodes.values()):
        parser.error('Use distinct valid WIRE_ID=CANONICAL_ID pairs')
    nodes[parts[0]] = {'id': parts[1], 'token': secrets.token_urlsafe(32)}
existing = args.app_env.read_text(encoding='utf-8') if args.app_env.exists() else ''
for line in existing.splitlines():
    match = re.match(r'^\s*(?:export\s+)?FOREST_INGEST_TOKEN\s*=\s*(.*?)\s*$', line)
    if match and match.group(1).strip().strip('"\''):
        parser.error('App ingestion token already exists; provision manually to avoid replacing it')
token = secrets.token_urlsafe(32)
def create_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            file.write(text)
            file.flush()
            os.fsync(file.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
args.nodes.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
paths = [args.nodes.resolve(), args.receiver_env.resolve(), args.app_env.resolve()]
if len(set(paths)) != len(paths) or not all(path.parent.is_dir() and os.access(path.parent, os.W_OK) for path in paths):
    parser.error('Credential paths must be distinct and their parent directories writable')
if args.app_env.exists() and (not args.app_env.is_file() or not os.access(args.app_env, os.W_OK)):
    parser.error('App environment must be a writable file')
checkout = args.app_env.resolve().parent
config = (f'RECEIVER_NODES_FILE="{args.nodes.resolve()}"\n'
          f'RECEIVER_DATABASE="{checkout / "data/receiver/spool.sqlite"}"\n'
          f'RECEIVER_MODEL="{checkout / "data/models/honest_chainsaw_model.tflite"}"\n'
          'WEBSITE_LOCATION_URL=http://127.0.0.1:3000/api/ingest\n'
          f'WEBSITE_API_TOKEN={token}\n')
created = []
temp_path = None
try:
    for path, content in ((args.nodes, json.dumps(nodes, indent=2) + '\n'), (args.receiver_env, config)):
        create_private(path, content)
        created.append(path)
    fd, name = tempfile.mkstemp(prefix='.forest-env-', dir=args.app_env.parent)
    temp_path = Path(name)
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        file.write(existing + ('\n' if existing and not existing.endswith('\n') else '') + f'FOREST_INGEST_TOKEN={token}\n')
        file.flush()
        os.fsync(file.fileno())
    os.replace(temp_path, args.app_env)
except BaseException:
    for path in created:
        path.unlink(missing_ok=True)
    if temp_path:
        temp_path.unlink(missing_ok=True)
    raise
print('Provisioned private files. Deliver each node its own token securely.')
