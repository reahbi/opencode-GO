[🇰🇷 한국어](opencode-kr.md)

# OpenCode Server Setup Guide

OpenCode-Go communicates with the OpenCode AI coding assistant server to perform tasks. This document guides you through installing and configuring the OpenCode server.

## OpenCode Overview

OpenCode is a powerful AI coding assistant server. OpenCode-Go connects to this server to relay conversations with AI and code modification requests through Telegram.

## Installation and Startup

1. For installation instructions, refer to the official OpenCode documentation (https://opencode.ai) or the project's README.
2. To start the server, run the following command:
   ```bash
   opencode serve
   ```
   By default, the server runs on port 4096.

## Verifying Server Connection

To verify the server is running properly, use the following command:
```bash
curl http://127.0.0.1:4096/health
```
If everything is working, you'll receive a status response from the server.

## Port Configuration

To use a port other than the default (4096), run:
```bash
opencode serve --port 8080
```
In this case, you must update `OPENCODE_SERVER_URL` in OpenCode-Go's `.env` file:
`OPENCODE_SERVER_URL=http://127.0.0.1:8080`

## Authentication Setup (Optional)

For security, you can set a password for the OpenCode server using the `OPENCODE_SERVER_PASSWORD` environment variable.

**WSL/Linux/macOS:**
```bash
OPENCODE_SERVER_PASSWORD=your-password opencode serve --port 4096 &
```

**Windows** (requires .bat wrapper):
```bash
cat > server.bat << 'BATEOF'
@echo off
set OPENCODE_SERVER_PASSWORD=your-password
opencode serve --port 4096
BATEOF
powershell.exe -Command "Start-Process '$(wslpath -w $(pwd)/server.bat)' -WindowStyle Minimized"
```

Then update OpenCode-Go's `.env` file to match:
```
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=your-password
```

Verify the connection:
```bash
curl -s -u opencode:your-password http://127.0.0.1:4096/project
```

## Using a Remote Server

If the OpenCode server is running on a different machine:
1. Set `OPENCODE_SERVER_URL` in the `.env` file to that server's IP address.
   Example: `OPENCODE_SERVER_URL=http://192.168.1.100:4096`
2. Ensure the firewall on that server allows port 4096 (or your configured port).
