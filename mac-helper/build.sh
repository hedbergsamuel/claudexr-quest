#!/bin/bash
# Build claudexr-capture and sign it ad hoc with a stable identifier.
#   ./build.sh                      -> .build/release/claudexr-capture
#   ./build.sh --build-path DIR     -> DIR/release/claudexr-capture (e.g. a scratch dir, leaves .build untouched)
set -euo pipefail
cd "$(dirname "$0")"
BP=".build"
if [ "${1:-}" = "--build-path" ] && [ -n "${2:-}" ]; then BP="$2"; fi
swift build -c release --build-path "$BP"
BIN="$BP/release/claudexr-capture"
codesign --force --sign - --identifier com.claudexr.capture "$BIN"
echo "Built and signed: $BIN"
codesign -dvv "$BIN" 2>&1 | grep -E "Identifier|CDHash" || true
cat <<'MSG'

OBS: en ad hoc-signatur har ingen utvecklaridentitet, så macOS identifierar programmet på dess cdhash.
Ändrad kod (varje ombygge) ger ny cdhash, och då kan "Skärm- och systemljudsinspelning" behöva tillåtas
på nytt (Systeminställningar -> Integritet och säkerhet). Ta bort den gamla posten och lägg till igen vid -3801.
MSG
