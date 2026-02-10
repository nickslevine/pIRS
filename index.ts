/**
 * Bash Token Tracker
 *
 * Monitors every bash tool invocation and records:
 * - The command executed
 * - The output size (characters and estimated tokens)
 * - Timestamp
 *
 * Provides /bash-stats command to view aggregated data,
 * with grouping by command pattern (e.g., pytest vs vitest).
 *
 * Token estimation: ~4 chars per token (rough approximation).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@mariozechner/pi-coding-agent";

const CHARS_PER_TOKEN = 4;

interface BashRecord {
	timestamp: number;
	command: string;
	outputChars: number;
	estimatedTokens: number;
	truncated: boolean;
	isError: boolean;
}

// Pattern groups for categorization.
// Each entry: [groupName, ...matchPatterns]
// A pattern matches if the command contains it as a substring.
const COMMAND_GROUPS: [string, ...string[]][] = [
	["pytest", "pytest", "python3 -m pytest", "python -m pytest", "uv run pytest", "uv run python -m pytest"],
	["vitest", "vitest"],
	["jest", "jest"],
	["tsc", "tsc"],
	["eslint", "eslint"],
	["npm install", "npm install", "npm ci", "pnpm install", "pnpm i", "bun install", "bun add"],
	["npm run", "npm run", "pnpm run", "pnpm exec", "bun run"],
	["npm", "npm ", "pnpm ", "bun "],
	["pip", "pip install", "pip3 install", "uv add", "uv pip install", "uv pip compile", "uv pip sync"],
	["uv", "uv run", "uv sync", "uv lock", "uv venv", "uv init", "uv remove", "uv tree", "uv "],
	["git", "git "],
	["grep/rg", "grep ", "rg "],
	["find", "find "],
	["cat/head/tail", "cat ", "head ", "tail "],
	["ls", "ls "],
	["file ops", "cp ", "mv ", "mkdir ", "rm ", "rmdir ", "chmod ", "chown ", "ln ", "touch "],
	["docker", "docker "],
	["curl/wget", "curl ", "wget "],
	["cargo test", "cargo test"],
	["cargo fmt", "cargo fmt"],
	["cargo clippy", "cargo clippy"],
	["cargo", "cargo "],
	["go", "go build", "go test", "go run"],
	["make", "make "],
];

// Extract the first real command from a string, skipping cd/env prefixes
function extractBaseCommand(command: string): string {
	let cmd = command.trim();
	// Strip leading "cd ... &&" or "cd ...;"
	cmd = cmd.replace(/^(cd\s+[^;&]+[;&]\s*)+/, "");
	// Strip leading env vars like FOO=bar
	cmd = cmd.replace(/^(\w+=\S+\s+)+/, "");
	return cmd.trim();
}

// Extract npx/bunx subcommand name
function extractRunnerCommand(base: string, runner: string): string | null {
	const match = base.match(new RegExp(`${runner}\\s+(?:--\\s+)?([\\w@/.:-]+)`));
	if (!match) return null;
	// Strip scope/version: @foo/bar@1.0 -> @foo/bar, plain-name -> plain-name
	const pkg = match[1].replace(/@[\d^~>=<.*]+$/, "");
	return pkg;
}

function classifyCommand(command: string): string {
	const base = extractBaseCommand(command);

	// Dynamic grouping for npx/bunx — each subcommand gets its own group
	for (const runner of ["npx", "bunx", "uvx"]) {
		if (base.startsWith(`${runner} `)) {
			const sub = extractRunnerCommand(base, runner);
			if (sub) return `${runner} ${sub}`;
			return runner;
		}
	}

	// Static pattern matching
	for (const [groupName, ...patterns] of COMMAND_GROUPS) {
		for (const pattern of patterns) {
			if (base.includes(pattern)) {
				return groupName;
			}
		}
	}
	return "other";
}

function estimateTokens(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function formatBytes(chars: number): string {
	if (chars >= 1_048_576) return `${(chars / 1_048_576).toFixed(1)}MB`;
	if (chars >= 1_024) return `${(chars / 1_024).toFixed(1)}KB`;
	return `${chars}B`;
}

// ANSI color helpers
const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	white: "\x1b[97m",
	cyan: "\x1b[36m",
	yellow: "\x1b[33m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	grey: "\x1b[90m",
};

export default function (pi: ExtensionAPI) {
	let records: BashRecord[] = [];
	// Map of toolCallId -> command, to correlate call with result
	const pendingCalls = new Map<string, string>();

	// Restore state from session
	pi.on("session_start", async (_event, ctx) => {
		records = [];
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "bash-token-tracker") {
				// Each entry stores the full records array
				records = (entry.data as { records: BashRecord[] })?.records ?? [];
			}
		}
		updateWidget(ctx);
	});

	// Capture the command on tool_call
	pi.on("tool_call", async (event, _ctx) => {
		if (isToolCallEventType("bash", event)) {
			pendingCalls.set(event.toolCallId, event.input.command);
		}
	});

	// Capture output on tool_result
	pi.on("tool_result", async (event, ctx) => {
		if (!isBashToolResult(event)) return;

		const command = pendingCalls.get(event.toolCallId) ?? (event.input as { command?: string }).command ?? "<unknown>";
		pendingCalls.delete(event.toolCallId);

		// Calculate output size from content
		let outputChars = 0;
		for (const part of event.content) {
			if (part.type === "text") {
				outputChars += part.text.length;
			}
		}

		const record: BashRecord = {
			timestamp: Date.now(),
			command,
			outputChars,
			estimatedTokens: estimateTokens(outputChars),
			truncated: !!event.details?.truncation?.truncated,
			isError: event.isError,
		};

		records.push(record);

		// Persist state
		pi.appendEntry("bash-token-tracker", { records: [...records] });

		updateWidget(ctx);
	});

	function updateWidget(ctx: { ui?: any; hasUI?: boolean }) {
		if (!(ctx as any).hasUI) return;

		if (records.length === 0) {
			ctx.ui?.setWidget("bash-tracker", undefined);
			return;
		}

		const totalTokens = records.reduce((sum, r) => sum + r.estimatedTokens, 0);
		const totalChars = records.reduce((sum, r) => sum + r.outputChars, 0);

		const line = `🔍 ${c.bold}${c.white}Bash:${c.reset} ${c.cyan}${records.length}${c.reset} calls | ~${c.yellow}${formatNumber(totalTokens)}${c.reset} tokens | ${c.green}${formatBytes(totalChars)}${c.reset} output`;
		ctx.ui?.setWidget("bash-tracker", [line]);
	}

	// /pirs command - show aggregated stats
	pi.registerCommand("pirs", {
		description: "Show bash command token usage statistics",
		handler: async (args, ctx) => {
			if (records.length === 0) {
				ctx.ui.notify("No bash commands recorded yet.", "info");
				return;
			}

			const mode = args?.trim() || "summary";

			if (mode === "all") {
				// Show all individual commands
				const lines: string[] = [`${c.bold}${c.cyan}═══ Bash Token Usage (All Commands) ═══${c.reset}`, ""];

				for (const r of records) {
					const time = new Date(r.timestamp).toLocaleTimeString();
					const cmd = r.command.length > 80 ? r.command.slice(0, 77) + "..." : r.command;
					const flags = [
						r.truncated ? `${c.red}TRUNCATED${c.reset}` : "",
						r.isError ? `${c.red}ERROR${c.reset}` : "",
					]
						.filter(Boolean)
						.join(" ");
					lines.push(`${c.grey}[${time}]${c.reset} ~${c.yellow}${formatNumber(r.estimatedTokens)}${c.reset} tokens ${c.grey}(${formatBytes(r.outputChars)})${c.reset} ${flags}`);
					lines.push(`  ${c.green}$${c.reset} ${c.white}${cmd}${c.reset}`);
					lines.push("");
				}

				const totalTokens = records.reduce((sum, r) => sum + r.estimatedTokens, 0);
				lines.push(`${c.bold}${c.white}Total:${c.reset} ${c.cyan}${records.length}${c.reset} commands | ~${c.yellow}${formatNumber(totalTokens)}${c.reset} tokens`);

				ctx.ui.notify(lines.join("\n"), "info");
			} else if (mode === "top") {
				// Show top 10 by token count
				const sorted = [...records].sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 10);
				const lines: string[] = [`${c.bold}${c.cyan}═══ Top 10 Bash Commands by Token Output ═══${c.reset}`, ""];

				for (let i = 0; i < sorted.length; i++) {
					const r = sorted[i];
					const cmd = r.command.length > 70 ? r.command.slice(0, 67) + "..." : r.command;
					lines.push(`${c.bold}${c.white}${i + 1}.${c.reset} ~${c.yellow}${formatNumber(r.estimatedTokens)}${c.reset} tokens — ${c.green}$${c.reset} ${c.white}${cmd}${c.reset}`);
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} else {
				// Summary (default) or groups (with example commands)
				const showCommands = mode === "groups";
				const groups = new Map<string, { count: number; totalTokens: number; totalChars: number; commands: string[] }>();

				for (const r of records) {
					const group = classifyCommand(r.command);
					const existing = groups.get(group) || { count: 0, totalTokens: 0, totalChars: 0, commands: [] };
					existing.count++;
					existing.totalTokens += r.estimatedTokens;
					existing.totalChars += r.outputChars;
					if (showCommands && existing.commands.length < 3) {
						const cmd = r.command.length > 60 ? r.command.slice(0, 57) + "..." : r.command;
						existing.commands.push(cmd);
					}
					groups.set(group, existing);
				}

				// Sort by total tokens descending
				const sorted = [...groups.entries()].sort((a, b) => b[1].totalTokens - a[1].totalTokens);

				const title = showCommands ? "Bash Token Usage by Group" : "Bash Token Usage";
				const lines: string[] = [`${c.bold}${c.cyan}═══ ${title} ═══${c.reset}`, ""];
				const totalTokens = records.reduce((sum, r) => sum + r.estimatedTokens, 0);

				for (const [group, data] of sorted) {
					const pct = ((data.totalTokens / totalTokens) * 100).toFixed(1);
					lines.push(`${c.bold}${c.magenta}▸ ${group}:${c.reset} ~${c.yellow}${formatNumber(data.totalTokens)}${c.reset} tokens ${c.grey}(${pct}%)${c.reset} — ${c.cyan}${data.count}${c.reset} calls, ${c.green}${formatBytes(data.totalChars)}${c.reset}`);
					if (showCommands) {
						for (const cmd of data.commands) {
							lines.push(`    ${c.green}$${c.reset} ${c.white}${cmd}${c.reset}`);
						}
						lines.push("");
					}
				}

				if (!showCommands) lines.push("");
				lines.push(`${c.bold}${c.white}Total:${c.reset} ${c.cyan}${records.length}${c.reset} commands | ~${c.yellow}${formatNumber(totalTokens)}${c.reset} tokens`);

				ctx.ui.notify(lines.join("\n"), "info");
			}
		},
	});

	// /pirs-reset command
	pi.registerCommand("pirs-reset", {
		description: "Reset bash token tracking data",
		handler: async (_args, ctx) => {
			const count = records.length;
			records = [];
			pi.appendEntry("bash-token-tracker", { records: [] });
			updateWidget(ctx);
			ctx.ui.notify(`Cleared ${count} bash records.`, "info");
		},
	});

	// /pirs-export command — dump to a JSON file
	pi.registerCommand("pirs-export", {
		description: "Export bash token tracking data to a JSON file",
		handler: async (_args, ctx) => {
			if (records.length === 0) {
				ctx.ui.notify("No data to export.", "info");
				return;
			}

			const filename = `.pi/pirs-${Date.now()}.json`;
			const data = {
				exported: new Date().toISOString(),
				summary: {
					totalCommands: records.length,
					totalTokens: records.reduce((s, r) => s + r.estimatedTokens, 0),
					totalChars: records.reduce((s, r) => s + r.outputChars, 0),
				},
				records,
			};

			const fs = await import("node:fs");
			const path = await import("node:path");
			const fullPath = path.resolve(ctx.cwd, filename);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));

			ctx.ui.notify(`Exported ${records.length} records to ${filename}`, "info");
		},
	});
}
