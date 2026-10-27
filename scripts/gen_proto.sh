#!/usr/bin/env bash
# Regenerate Python bindings from the vendored flipperzero-protobuf definitions.
# Upstream: https://github.com/flipperdevices/flipperzero-protobuf
set -euo pipefail
cd "$(dirname "$0")/.."
out=src/iflipper/proto
python3 -m grpc_tools.protoc -Iproto --python_out="$out" proto/*.proto
# protoc emits absolute imports ("import storage_pb2"); make them package-relative.
sed -i -E 's/^import (\w+_pb2) as/from . import \1 as/' "$out"/*_pb2.py
# Drop the strict runtime-version pin so the bindings work with any protobuf>=4.21.
python3 - "$out" <<'PY'
import pathlib, re, sys
for f in pathlib.Path(sys.argv[1]).glob("*_pb2.py"):
    src = f.read_text()
    src = re.sub(r"from google\.protobuf import runtime_version as _runtime_version\n", "", src)
    src = re.sub(r"_runtime_version\.ValidateProtobufRuntimeVersion\([^)]*\)\n", "", src)
    f.write_text(src)
PY
