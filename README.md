# dot

bash tool to manage dotfiles via git + symlinks

## Usage

```
dot init <github-url>  - clone repo + set up symlinks
dot                    - pull latest + show status + fix issues
dot <file>             - track a file (move to repo + symlink)
dot rm <file>          - untrack a file (restore to home)
dot upgrade            - upgrade dot to latest version
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/prichodko/dot/main/bin/dot | bash
```

Then initialize with your dotfiles repo:

```bash
dot init <github-url>
```

## Tip

Alias to `.` for quick access:

```bash
alias .="dot"
```

Ensure `~/.local/bin` is in your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```
