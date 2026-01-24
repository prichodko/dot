# dot

bash tool to manage dotfiles via git + symlinks

## Usage

```
dot init <github-url>  - clone repo + set up symlinks
dot                    - pull latest + show status + fix issues
dot <file>             - track a file (move to repo + symlink)
dot rm <file>          - untrack a file (restore to home)
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/prichodko/dot/main/bin/dot | bash -s init <github-url>
```

## Tip

Alias to `.` for quick access:

```bash
alias .="dot"
```
