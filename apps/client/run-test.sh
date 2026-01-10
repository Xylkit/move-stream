#!/bin/bash

# Quick test runner for test-cycles.ts
# Automatically extracts private key from contract config

set -e

# Get private key from contract config
PRIVATE_KEY=$(cat ../contract-movement/.aptos/config.yaml | grep private_key | awk '{print $2}' | sed 's/ed25519-priv-//')

if [ -z "$PRIVATE_KEY" ]; then
  echo "❌ Could not find private key in ../contract-movement/.aptos/config.yaml"
  echo ""
  echo "Make sure you have:"
  echo "  1. Started the testnet: aptos node run-local-testnet --force-restart --assume-yes"
  echo "  2. Initialized the account: cd ../contract-movement && aptos init --network custom --rest-url http://127.0.0.1:8080 --faucet-url http://127.0.0.1:8081 --profile default --assume-yes"
  exit 1
fi

echo "🔑 Using private key: ${PRIVATE_KEY:0:20}..."
echo ""

# Run the test
PRIVATE_KEY="$PRIVATE_KEY" npx tsx test-cycles.ts
