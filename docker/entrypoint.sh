#!/bin/sh
set -eu

node /app/apps/worker/dist/index.js &
exec node /app/apps/server/dist/index.js
