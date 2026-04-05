#!/usr/bin/env bash
set -euo pipefail

REQUIRED_NODE_MAJOR=22

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed."
  echo "Install Node.js ${REQUIRED_NODE_MAJOR}.x and rerun this script."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm is not installed."
  echo "Install npm (bundled with Node.js) and rerun this script."
  exit 1
fi

NODE_VERSION="$(node -v)"
NODE_MAJOR="$(echo "${NODE_VERSION}" | sed -E 's/^v([0-9]+).*/\1/')"
NPM_VERSION="$(npm -v)"

echo "Detected Node.js ${NODE_VERSION}"
echo "Detected npm ${NPM_VERSION}"

if [ "${NODE_MAJOR}" -lt "${REQUIRED_NODE_MAJOR}" ]; then
  echo "❌ Node.js ${NODE_VERSION} is too old."
  echo "Please use Node.js ${REQUIRED_NODE_MAJOR}.x or newer."
  exit 1
fi

echo "Installing dependencies with npm ci..."
npm ci

echo
echo "✅ Bootstrap complete."
echo "Run the app with:"
echo "  npm run dev        # start development server (http://localhost:5173)"
echo "  npm run test       # run tests"
echo "  npm run build      # create production build"
