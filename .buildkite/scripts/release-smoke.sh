#!/usr/bin/env bash
set -euo pipefail

echo "release smoke: branch=${BUILDKITE_BRANCH:-unknown} commit=${BUILDKITE_COMMIT:-unknown}"
git fetch --tags --force

bun install --frozen-lockfile

echo "release smoke: package=$(jq -r .name package.json) version=$(jq -r .version package.json)"
echo "release smoke: ok"
