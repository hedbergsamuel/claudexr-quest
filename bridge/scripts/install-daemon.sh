#!/bin/bash
# Install (or reinstall) the ClaudeXR daemon as a per-user launchd agent. No sudo needed. Usage:
#   bash scripts/install-daemon.sh            # build, copy to a pinned location, install + start
#   bash scripts/install-daemon.sh uninstall  # stop + remove the agent and the pinned copy (keeps ~/.claudexr)
#
# Review 2 R2-03:
# - The daemon decides on Claude's permission requests, so it must not run from the working tree that
#   Claude edits. It runs from a copy in ~/Library/Application Support/ClaudeXR/<version> that is only
#   replaced when you run this script again (re-run it after every update/build you trust).
# - launchd starts agents with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so Homebrew tools (whisper-cli)
#   were not found. PATH is set explicitly.
# - The log goes to ~/Library/Logs/ClaudeXR (Umask 077) instead of world-readable /tmp: it contains the
#   pairing code.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LABEL_NAME="com.claudexr.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL_NAME.plist"
DOMAIN="gui/$(id -u)"
APP_DIR="$HOME/Library/Application Support/ClaudeXR"
LOG_DIR="$HOME/Library/Logs/ClaudeXR"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL_NAME" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$APP_DIR/bridge"
  # the `xr` wrapper, if it is ours
  XR_WRAPPER="${XR_BINDIR:-$HOME/bin}/xr"
  grep -q "claudexr: manual override" "$XR_WRAPPER" 2>/dev/null && rm -f "$XR_WRAPPER"
  echo "ClaudeXR daemon removed. Settings, token and pairings remain in ~/.claudexr (delete by hand if wanted)."
  echo "Also remove the claudexr MCP server and the hooks from ~/.claude/settings.json (claude mcp remove claudexr)."
  exit 0
fi

NODE="$(command -v node)"
[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }
# Always build: a stale dist/ would silently keep old code running.
(cd "$HERE" && npm run build --silent)

# Pinned copy (dist + production dependencies + helper binary if built).
DEST="$APP_DIR/bridge"
rm -rf "$DEST.new"
mkdir -p "$DEST.new"
cp -R "$HERE/dist" "$HERE/package.json" "$HERE/node_modules" "$DEST.new/"
HELPER_SRC="$ROOT/mac-helper/.build/release/claudexr-capture"
if [ -x "$HELPER_SRC" ]; then
  mkdir -p "$DEST.new/bin" && cp "$HELPER_SRC" "$DEST.new/bin/claudexr-capture"
fi
chmod -R go-w "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$LOG_DIR"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
AGENT_PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CAPTURE_BIN="$DEST/bin/claudexr-capture"
[ -x "$CAPTURE_BIN" ] || CAPTURE_BIN="$HELPER_SRC"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$DEST/dist/src/index.js")</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- 0.3.0: NOT ProcessType Background / LowPriorityIO. Children (whisper, claudexr-capture) inherit that class and
       were throttled to the efficiency cores: speech recognition took 50 s for 6 s of audio and video frames were dropped. -->
  <key>ProcessType</key><string>Interactive</string>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$AGENT_PATH")</string>
    <key>CLAUDEXR_CAPTURE_BIN</key><string>$(xml "$CAPTURE_BIN")</string>
    <key>CLAUDEXR_BUGS_DIR</key><string>$(xml "$ROOT/bugs")</string>
    <key>CLAUDEXR_QUIET</key><string>0</string>
  </dict>
  <key>StandardOutPath</key><string>$(xml "$LOG_DIR/bridge.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_DIR/bridge.log")</string>
</dict>
</plist>
PLIST
chmod 600 "$PLIST"

# 0.3.1: `xr on|off|status` (manual override of the hook flag). A small wrapper around the pinned daemon copy. An
# existing ~/bin/xr that is not ClaudeXR's (does not mention claudexr) is left alone.
BINDIR="${XR_BINDIR:-$HOME/bin}"
XR_WRAPPER="$BINDIR/xr"
if [ ! -e "$XR_WRAPPER" ] || grep -qi claudexr "$XR_WRAPPER" 2>/dev/null; then
  mkdir -p "$BINDIR"
  printf '#!/bin/bash\n# claudexr: manual override of the ClaudeXR hook flag (xr on | xr off | xr status)\nexec %q %q xr "$@"\n' "$NODE" "$DEST/dist/src/index.js" > "$XR_WRAPPER"
  chmod 755 "$XR_WRAPPER"
  case ":$PATH:" in *":$BINDIR:"*) ;; *) echo "NOTE: $BINDIR is not in your PATH (export PATH=\"$BINDIR:\$PATH\")" ;; esac
else
  echo "NOTE: $XR_WRAPPER exists and is not ClaudeXR's: left alone. Use: node \"$DEST/dist/src/index.js\" xr on|off|status"
fi

launchctl bootout "$DOMAIN/$LABEL_NAME" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 1
launchctl print "$DOMAIN/$LABEL_NAME" | grep -E "state|pid" | head -3 || true
echo "Installed from: $DEST (re-run this script after updates you trust)"
echo "Logs: tail -f \"$LOG_DIR/bridge.log\""
echo "Hooks (0.3.1: gated by ~/.claudexr/on, the bridge sets the flag while a headset is connected):"
echo "  node \"$DEST/dist/src/index.js\" install-hooks --dry-run   # show the diff of ~/.claude/settings.json"
echo "  node \"$DEST/dist/src/index.js\" install-hooks             # backup + write (idempotent)"
echo "MCP registration: node \"$DEST/dist/src/index.js\" print-config"
echo "Manual override: xr on | xr off | xr status"
