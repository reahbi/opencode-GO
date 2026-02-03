# Troubleshooting Guide

This guide covers common issues you may encounter while using OpenCode-Go and their solutions.

## <a id="env-missing"></a>Missing Environment Variables

**Symptom**: `BOT_TOKEN is required. Set it in .env file.` error on startup
**Cause**: `.env` file doesn't exist or required environment variables are not set
**Solution**:
```bash
cp .env.example .env
```
Then open the `.env` file and set the required variables: `BOT_TOKEN`, `ALLOWED_USER_IDS`, `DEFAULT_PROJECT`, etc.

## <a id="invalid-user-id"></a>Invalid User ID Format

**Symptom**: `Invalid user ID: abc123` error
**Cause**: Non-numeric string or invalid format entered in `ALLOWED_USER_IDS`
**Solution**:
Verify your numeric ID through @userinfobot, then enter only numbers in the `.env` file. Separate multiple IDs with commas.

## <a id="server-unreachable"></a>Cannot Connect to OpenCode Server

**Symptom**: `Cannot connect to OpenCode at http://...` error
**Cause**: OpenCode server is not running, URL is misconfigured, or blocked by firewall
**Solution**:
```bash
# Verify server is running
opencode serve
# Test connection
curl http://127.0.0.1:4096/health
```
Verify that `OPENCODE_SERVER_URL` in `.env` matches the actual server address.

## <a id="token-invalid"></a>Invalid Bot Token

**Symptom**: `Unauthorized` error from Telegram API
**Cause**: Bot token is incorrect or has been revoked by @BotFather
**Solution**:
Copy the exact token from @BotFather and paste it into `BOT_TOKEN` in `.env`. If needed, generate a new token.

## <a id="no-response"></a>Bot Not Responding

**Symptom**: Sent a message but bot shows no reaction
**Cause**: Your Telegram ID is not included in `ALLOWED_USER_IDS` (silently ignored for security)
**Solution**:
Verify your ID and add it to `ALLOWED_USER_IDS` in `.env`, then restart the bot.

## <a id="project-not-found"></a>Project Directory Not Found

**Symptom**: `Project at /path/to/project not found` error
**Cause**: Path set in `DEFAULT_PROJECT` doesn't exist, or relative path used instead of absolute
**Solution**:
```bash
ls -d /absolute/path/to/project
```
Verify the path exists and always use an absolute path.

## <a id="state-corruption"></a>state.json Corruption

**Symptom**: `Failed to parse state file` error
**Cause**: `data/state.json` file is corrupted, possibly due to abnormal termination
**Solution**:
```bash
rm data/state.json
```
Delete the file and restart the bot — it will be auto-regenerated with default values.

## <a id="permission-denied"></a>File Permission Issues

**Symptom**: `EACCES: permission denied` error
**Cause**: No write permission for `data/` directory or log files
**Solution**:
```bash
chmod 755 data/
```
Check directory ownership and permissions to ensure the running user can write files.

## <a id="bun-not-found"></a>Bun Not Installed / PATH Issue

**Symptom**: `bun: command not found` error
**Cause**: Bun is not installed, or installation path is not in system PATH
**Solution**:
Refer to `docs/setup/bun.md` to install Bun and configure PATH.

## <a id="port-in-use"></a>Port Conflict

**Symptom**: `address already in use` error (when starting server)
**Cause**: Another process is already using the same port (default 4096)
**Solution**:
```bash
lsof -i :4096
```
Either terminate the process using that port or start the server on a different port.

---

## Multi-Bot Related Issues

## <a id="group-no-response"></a>Bot Not Responding in Group Chat

**Symptom**: Bot doesn't respond even when @mentioned in group
**Cause**: Group chat feature is disabled or BotFather settings are missing
**Solution**:
1. Verify `GROUP_CHAT_ENABLED=true` in `.env`
2. In BotFather: Bot Settings → `Allow Groups?` → `Enabled`
3. Restart the bot and re-invite it to the group

## <a id="debate-not-working"></a>/debate Command Not Working

**Symptom**: Debate doesn't start after `/debate` command
**Cause**: Bot role not configured or coordination directory mismatch
**Solution**:
1. Verify both bots have `BOT_ROLE` set to `writer` and `reader` respectively
2. Verify both bots have **exactly the same** `COORDINATION_DIR` path
3. Check if the other bot is online using `/bots` command

## <a id="coordination-dir"></a>Bot-to-Bot Communication Failure

**Symptom**: Collaboration features like `/debate`, `/review` don't work
**Cause**: `COORDINATION_DIR` paths differ or directory permission issues
**Solution**:
```bash
# Verify all bots use the same path
echo $COORDINATION_DIR

    # Check directory permissions
    ls -la /tmp/opencode-go-coordination/
```

## <a id="duplicate-groupsettings"></a>Duplicate /groupsettings Responses

**Symptom**: Multiple bots respond simultaneously to `/groupsettings` command
**Cause**: Bot version mismatch (only some bots updated)
**Solution**:
```bash
pm2 restart all
```
Update all bots to the same version and restart.
