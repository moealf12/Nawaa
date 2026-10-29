#!/usr/bin/env bash
set -euo pipefail
[[ "${RENDER:-}" == "true" && "${RENDER_SERVICE_ID:-}" == "srv-dau4olo93c1s73cnj9a0" &&
   "${NAWAA_PYTHON_PREPARE:-}" == "1" ]] ||
  { echo "NAWAA_PYTHON_PROVISION_DENIED"; exit 1; }
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] ||
  { echo "NAWAA_PYTHON_PLATFORM_UNSUPPORTED"; exit 1; }
command -v curl >/dev/null
command -v sha256sum >/dev/null
command -v tar >/dev/null
ROOT="$(pwd -P)"
PROJECT="$ROOT/workers/python-intelligence"
[[ -f "$PROJECT/pyproject.toml" && -f "$PROJECT/uv.lock" ]] ||
  { echo "NAWAA_PYTHON_LOCK_MISSING"; exit 1; }
# Exact official uv GitHub release artifact; SHA256 verified before executing it.
# No curl | sh, privileged command, new service, or paid infrastructure.
UV_VERSION="0.10.0"
ASSET="uv-x86_64-unknown-linux-gnu.tar.gz"
RELEASE="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --retry 0 --connect-timeout 12 --max-time 95 \
  "$RELEASE/$ASSET" -o "$TEMP/$ASSET"
curl --proto '=https' --tlsv1.2 -fsSL --retry 0 --connect-timeout 12 --max-time 30 \
  "$RELEASE/$ASSET.sha256" -o "$TEMP/$ASSET.sha256"
(cd "$TEMP" && sha256sum -c "$ASSET.sha256")
tar -xzf "$TEMP/$ASSET" -C "$TEMP"
UV="$TEMP/uv-x86_64-unknown-linux-gnu/uv"
[[ -x "$UV" ]] || { echo "NAWAA_PYTHON_UV_BIN_MISSING"; exit 1; }
[[ "$("$UV" --version)" == "uv $UV_VERSION" ]] ||
  { echo "NAWAA_PYTHON_UV_VERSION_MISMATCH"; exit 1; }

# Both standalone Python itself and its venv belong to the deploy artifact.
export UV_PYTHON_INSTALL_DIR="$ROOT/.render-python/python"
export UV_CACHE_DIR="$ROOT/.render-python/uv-cache"
export UV_LINK_MODE=copy
export UV_NO_PROGRESS=1
"$UV" sync --project "$PROJECT" --python 3.12 \
  --python-preference only-managed --locked --no-dev --no-editable

PY="$PROJECT/.venv/bin/python"
[[ -x "$PY" ]] || { echo "NAWAA_PYTHON_VENV_MISSING"; exit 1; }
RESOLVED="$(readlink -f "$PY")"
case "$RESOLVED" in "$ROOT"/.render-python/python/*) ;; *)
  echo "NAWAA_PYTHON_EXTERNAL_SYMLINK_REJECTED"; exit 1 ;;
esac
"$PY" -I -c 'import sys,httpx,bs4,lxml,pydantic,rapidfuzz,nawaa_py.jarir_pdp; assert sys.version_info[:2]==(3,12)'
rm -rf "$UV_CACHE_DIR"
echo 'NAWAA_PYTHON_BUILD_VERIFIED version=3.12 packages=5 venv=local managed_python=local flag_off'
