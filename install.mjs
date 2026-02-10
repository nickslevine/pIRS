#!/usr/bin/env node

/**
 * pIRS installer
 *
 * Usage:
 *   npx pirs          # Install to ~/.pi/agent/extensions/pirs
 *   npx pirs --remove # Remove the extension
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "pirs");
const REPO_URL = "https://github.com/nickslevine/pIRS.git";

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");

if (isHelp) {
	console.log(`
pIRS - Pi extension for tracking bash command token usage

Usage:
  npx pirs          Install the extension
  npx pirs --remove Remove the extension
  npx pirs --help   Show this help

Installation directory: ${EXTENSION_DIR}
`);
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		console.log(`Removing ${EXTENSION_DIR}...`);
		fs.rmSync(EXTENSION_DIR, { recursive: true });
		console.log("✓ pIRS removed");
	} else {
		console.log("pIRS is not installed");
	}
	process.exit(0);
}

// Install
console.log("Installing pIRS...\n");

// Ensure parent directory exists
const parentDir = path.dirname(EXTENSION_DIR);
if (!fs.existsSync(parentDir)) {
	fs.mkdirSync(parentDir, { recursive: true });
}

// Check if already installed
if (fs.existsSync(EXTENSION_DIR)) {
	const isGitRepo = fs.existsSync(path.join(EXTENSION_DIR, ".git"));
	if (isGitRepo) {
		console.log("Updating existing installation...");
		try {
			execSync("git pull", { cwd: EXTENSION_DIR, stdio: "inherit" });
			console.log("\n✓ pIRS updated");
		} catch (err) {
			console.error("Failed to update. Try removing and reinstalling:");
			console.error("  npx pirs --remove && npx pirs");
			process.exit(1);
		}
	} else {
		console.log(`Directory exists but is not a git repo: ${EXTENSION_DIR}`);
		console.log("Remove it first with: npx pirs --remove");
		process.exit(1);
	}
} else {
	// Fresh install
	console.log(`Cloning to ${EXTENSION_DIR}...`);
	try {
		execSync(`git clone ${REPO_URL} "${EXTENSION_DIR}"`, { stdio: "inherit" });
		console.log("\n✓ pIRS installed");
	} catch (err) {
		console.error("Failed to clone repository");
		process.exit(1);
	}
}

console.log(`
pIRS is now available in pi. Commands added:
  • /bash-stats          View bash command token usage (group, all, top)
  • /bash-stats-reset    Reset tracking data
  • /bash-stats-export   Export data to JSON

A status widget shows live stats in the TUI.
`);
