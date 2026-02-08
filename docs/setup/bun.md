[🇰🇷 한국어](bun-kr.md)

# Bun Installation Guide

OpenCode-Go runs on the Bun runtime. This document guides you through installing and configuring Bun.

## Bun Overview

Bun is an ultra-fast runtime, package manager, bundler, and test runner for JavaScript and TypeScript. Designed as an alternative to Node.js, it offers exceptional performance and native TypeScript support.

## Installation (Linux and macOS)

Run the following command in your terminal to install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

## Installation (Windows)

On Windows, we strongly recommend using WSL (Windows Subsystem for Linux). If you prefer a direct installation, run the following command in PowerShell:
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Verifying Installation

After installation, open a new terminal window and run the following command to verify:
```bash
bun --version
```
If a version number is displayed, the installation was successful.

## Troubleshooting PATH Issues

If you encounter a `bun: command not found` error, the Bun binary directory is not in your system's PATH environment variable.

1. You need to add `~/.bun/bin` to your PATH.
2. Run the following commands to add and apply the configuration:
   ```bash
   echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```
   - For zsh users, use `.zshrc` instead of `.bashrc`.

## Updating

To update Bun to the latest version, use the following command:
```bash
bun upgrade
```
