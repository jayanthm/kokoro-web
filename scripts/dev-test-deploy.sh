#!/usr/bin/env bash
set -euo pipefail

APP_NAME="kokoro-web"
DEV_IMAGE="${APP_NAME}:dev"
PROD_IMAGE="${APP_NAME}:prod"
PORT="${PORT:-5173}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") <command> [args]

Commands:
  dev                 Build and run the local development container.
  test                Run the test suite in an isolated container.
  deploy [tag]        Build the production image (tag defaults to latest).
  deploy-run [tag]    Build and run the production image on port 3000.
USAGE
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required but was not found in PATH." >&2
    exit 1
  fi
}

cmd_dev() {
  docker build --target dev -t "${DEV_IMAGE}" .
  docker run --rm -it \
    -p "${PORT}:5173" \
    -v "$(pwd):/app" \
    -v "${APP_NAME}-node-modules:/app/node_modules" \
    "${DEV_IMAGE}"
}

cmd_test() {
  docker build --target test -t "${DEV_IMAGE}-test" .
  docker run --rm -t "${DEV_IMAGE}-test"
}

cmd_deploy() {
  local tag="${1:-latest}"
  docker build --target prod -t "${PROD_IMAGE}:${tag}" .
  echo "Built ${PROD_IMAGE}:${tag}"
}

cmd_deploy_run() {
  local tag="${1:-latest}"
  cmd_deploy "${tag}"
  docker run --rm -it -p 3000:3000 "${PROD_IMAGE}:${tag}"
}

main() {
  ensure_docker

  case "${1:-}" in
    dev)
      shift
      cmd_dev "$@"
      ;;
    test)
      shift
      cmd_test "$@"
      ;;
    deploy)
      shift
      cmd_deploy "$@"
      ;;
    deploy-run)
      shift
      cmd_deploy_run "$@"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
