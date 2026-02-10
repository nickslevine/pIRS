# pIRS

Pi extension that tracks bash tool invocation token usage with live stats, grouping, and export.

Every time the AI runs a bash command, pIRS records the output size, estimates token count, and displays a live summary widget in the TUI.

## Installation

```bash
pi install npm:pirs
```

Or install via git:

```bash
pi install https://github.com/nickslevine/pIRS
```

To remove:

```bash
npx pirs --remove
```

## Features

- **Live widget** — shows total bash calls, estimated tokens, and output size in the TUI status bar
- **Command grouping** — categorizes commands (pytest, vitest, jest, git, grep, docker, etc.)
- **Session persistence** — stats survive across session restarts
- **Export** — dump full tracking data to JSON

## Commands

| Command | Description |
|---------|-------------|
| `/pirs` | Show token usage grouped by command type (default) |
| `/pirs all` | Show all individual commands with timestamps |
| `/pirs top` | Show top 10 commands by token output |
| `/pirs-reset` | Clear all tracking data |
| `/pirs-export` | Export tracking data to `.pi/pirs-<timestamp>.json` |

## How It Works

pIRS hooks into pi's `tool_call` and `tool_result` events to capture every bash invocation. It estimates tokens at ~4 characters per token and tracks:

- Command text
- Output size (characters)
- Estimated token count
- Whether output was truncated
- Whether the command errored
- Timestamp

Commands are automatically categorized into groups (pytest, vitest, jest, git, grep, docker, curl, etc.) for the grouped stats view.

## Example Output

```
═══ Bash Token Usage by Group ═══

▸ grep/rg: ~12.5k tokens (45.2%) — 23 calls, 48.8KB
    $ rg "import.*from" --type ts
    $ grep -r "TODO" src/

▸ pytest: ~8.3k tokens (30.1%) — 5 calls, 32.4KB
    $ pytest tests/test_auth.py -v

▸ other: ~6.8k tokens (24.7%) — 12 calls, 26.5KB
    $ echo "hello"

Total: 40 commands | ~27.6k tokens
```

## License

MIT
