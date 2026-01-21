#!/bin/bash
set -e

REPO="prichodko/dot"
INSTALL_DIR="$HOME/.local/bin"

echo "Installing dot..."

# install bun if needed
if ! command -v bun &> /dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# create install dir
mkdir -p "$INSTALL_DIR"

# clone and build
TEMP_DIR=$(mktemp -d)
git clone "https://github.com/$REPO.git" "$TEMP_DIR" --depth 1

cd "$TEMP_DIR"
bun install
bun build src/index.ts --compile --outfile "$INSTALL_DIR/dot"

# cleanup
rm -rf "$TEMP_DIR"

# add alias to shell rc
add_alias() {
  local rc="$1"
  if [ -f "$rc" ]; then
    if ! grep -q 'alias \.="dot"' "$rc"; then
      echo 'alias .="dot"' >> "$rc"
      echo "Added alias to $rc"
    fi
  fi
}

add_alias "$HOME/.zshrc"
add_alias "$HOME/.bashrc"

# ensure PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$HOME/.zshrc" 2>/dev/null || true
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$HOME/.bashrc" 2>/dev/null || true
fi

echo ""
echo "Installed! Restart your shell and run '.' to start."
