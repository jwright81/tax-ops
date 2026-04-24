#!/bin/sh
set -eu

node /app/apps/worker/dist/apps/worker/src/index.js &
exec node /app/apps/server/dist/apps/server/src/index.js
