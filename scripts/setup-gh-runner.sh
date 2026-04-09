#!/usr/bin/env bash
# setup-gh-runner.sh — Register Pi 5 as a self-hosted GitHub Actions runner
# Run this ON the Pi 5 (ssh andrew@100.112.68.52)
#
# Prerequisites:
#   1. GitHub PAT with repo + admin:org scope, or a runner registration token
#   2. Get a registration token from:
#      Settings → Actions → Runners → New self-hosted runner
#      OR: gh api repos/OWNER/REPO/actions/runners/registration-token -f -q .token
#
# Usage:
#   chmod +x scripts/setup-gh-runner.sh
#   GITHUB_TOKEN=<your-registration-token> ./scripts/setup-gh-runner.sh

set -euo pipefail

REPO_URL="https://github.com/andrewaws26/Viam-Staubli-Apera-PLC-Mobile-POC"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.322.0"  # bump as needed
ARCH="arm64"

# ── Preflight checks ────────────────────────────────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN not set."
  echo ""
  echo "Get a registration token from GitHub:"
  echo "  1. Go to: $REPO_URL/settings/actions/runners/new"
  echo "  2. Copy the token from the configure step"
  echo "  3. Re-run: GITHUB_TOKEN=<token> $0"
  exit 1
fi

echo "=== IronSight Dev Pi 5 — GitHub Actions Runner Setup ==="
echo "Repo:    $REPO_URL"
echo "Runner:  v$RUNNER_VERSION ($ARCH)"
echo "Dir:     $RUNNER_DIR"
echo ""

# ── Download runner ──────────────────────────────────────────────────
if [ -d "$RUNNER_DIR" ] && [ -f "$RUNNER_DIR/config.sh" ]; then
  echo "[SKIP] Runner already downloaded at $RUNNER_DIR"
else
  echo "[1/4] Downloading GitHub Actions runner..."
  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"
  curl -sL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${ARCH}-${RUNNER_VERSION}.tar.gz" -o runner.tar.gz
  tar xzf runner.tar.gz
  rm runner.tar.gz
  echo "  ✓ Downloaded and extracted"
fi

cd "$RUNNER_DIR"

# ── Configure runner ─────────────────────────────────────────────────
echo "[2/4] Configuring runner..."
./config.sh \
  --url "$REPO_URL" \
  --token "$GITHUB_TOKEN" \
  --name "ironsight-pi5" \
  --labels "dev-pi,ironsight,arm64,self-hosted" \
  --work "_work" \
  --replace \
  --unattended

echo "  ✓ Runner configured"

# ── Install as systemd service ───────────────────────────────────────
echo "[3/4] Installing as systemd service..."
sudo ./svc.sh install "$(whoami)"
sudo ./svc.sh start
echo "  ✓ Service installed and started"

# ── Verify ───────────────────────────────────────────────────────────
echo "[4/4] Verifying..."
sudo ./svc.sh status
echo ""
echo "=== Setup Complete ==="
echo ""
echo "The runner is now registered and will pick up jobs with:"
echo "  runs-on: [self-hosted, dev-pi]"
echo ""
echo "To check status:  cd $RUNNER_DIR && sudo ./svc.sh status"
echo "To stop:          cd $RUNNER_DIR && sudo ./svc.sh stop"
echo "To uninstall:     cd $RUNNER_DIR && sudo ./svc.sh uninstall"
echo ""
echo "Example workflow step:"
echo "  jobs:"
echo "    my-job:"
echo "      runs-on: [self-hosted, dev-pi]"
echo "      steps:"
echo "        - uses: actions/checkout@v4"
echo "        - run: echo 'Running on IronSight Pi 5!'"
