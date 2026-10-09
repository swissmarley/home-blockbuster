#!/bin/sh
# Runs the server as the unprivileged "node" user. Started as root (the default), it first hands the
# data folder to that user: folders created by older images, which ran as root, are owned by root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    echo "Giving the node user ownership of $DATA_DIR"
    chown -R node:node "$DATA_DIR"
  fi
  exec su-exec node "$@"
fi
exec "$@"
