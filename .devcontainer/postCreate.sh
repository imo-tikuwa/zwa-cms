#!/bin/bash
set -euo pipefail

echo "=== postCreate: configuring git user ==="
# Use GIT_USER_NAME / GIT_USER_EMAIL if provided.
# Otherwise, keep the .gitconfig copied from the host by the Dev Containers extension.
if [ -n "${GIT_USER_NAME:-}" ] && [ -n "${GIT_USER_EMAIL:-}" ]; then
  git config --global user.name "$GIT_USER_NAME"
  git config --global user.email "$GIT_USER_EMAIL"
  echo "  -> ${GIT_USER_NAME} <${GIT_USER_EMAIL}>"
else
  echo "  -> skipped (GIT_USER_NAME / GIT_USER_EMAIL not set)"
fi

echo "=== postCreate: installing pnpm ==="
sudo npm install -g pnpm@11

echo "=== postCreate: installing Rust toolchain ==="
if ! command -v rustc &> /dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
fi
source "$HOME/.cargo/env" || true

echo "=== postCreate: installing Tauri v2 Linux dependencies ==="
sudo apt-get update -qq
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  sqlite3 \
  libsqlite3-dev

# Optional personal setup. Create .devcontainer/postCreate.local.sh to install your own tools.
if [ -f .devcontainer/postCreate.local.sh ]; then
  echo "=== postCreate: running postCreate.local.sh ==="
  bash .devcontainer/postCreate.local.sh
fi

echo "=== postCreate: done ==="
