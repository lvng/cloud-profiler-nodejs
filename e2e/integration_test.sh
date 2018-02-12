#!/bin/bash

# Fail on any error.
set -eo pipefail

# Display commands being run.
set -x

# Set $GOPATH
export GOPATH="$HOME/go"

# Move test into $GOPATH and get dependencies
mkdir -p "$GOPATH/src"
cp -R "e2e" "$GOPATH/src"

#SERVICE_KEY="${KOKORO_KEYSTORE_DIR}/72935_cloud-profiler-e2e-service-account-key"
COMMIT=$(git rev-parse HEAD)

export GCLOUD_TESTS_NODEJS_PROJECT_ID="nodejs-cloud-kokoro"
export GCLOUD_TESTS_NODEJS_ZONE="us-west1-a"
export GOOGLE_APPLICATION_CREDENTIALS="/usr/local/google/home/nolanmar/nodejs-cloud-kokoro-c90b65366825.json"

# Test the agent
cd "$GOPATH/src/e2e"
go get -d -t ./
go test -timeout=30m -parallel=5 -tags=integration -run TestAgentIntegration -commit="$COMMIT"
