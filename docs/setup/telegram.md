[🇰🇷 한국어](telegram-kr.md)

# Telegram Bot Setup Guide

This document explains how to create a Telegram bot for controlling OpenCode-Go and obtain the necessary credentials.

## Bot Creation Process

1. Search for @BotFather in the Telegram app and start a conversation.
2. Send the `/start` message.
3. Send the `/newbot` command to begin creating a new bot.
4. Enter a name for your bot. (e.g., My OpenCode-Go)
5. Enter a username for your bot. This must end with `_bot`. (e.g., my_opencode_go_bot)
6. Upon completion, you'll receive your bot token.

## Bot Token Format

Bot tokens follow this format:
`123456789:ABCdefGHIjklMNO-pqrSTUvwxyz` (combination of numbers and alphanumeric characters)

**Security Warning**: Your bot token is like a password for your bot. If exposed, anyone can control your bot. Never share it with others or commit it to public repositories (GitHub, etc.).

## Finding Your Telegram User ID

OpenCode-Go is configured to allow only authorized users. To find your User ID, follow these steps:

1. Send any message to @userinfobot (https://t.me/userinfobot).
2. The numeric value in the bot's response is your User ID.
3. User ID format: Numbers only. (e.g., `7702469661`)

## Allowing Multiple Users

To allow multiple users to use the bot, add each user's ID to the `ALLOWED_USER_IDS` environment variable, separated by commas.
Example: `123456789,987654321`

## Group Chat Setup (Multi-Bot Mode)

Additional BotFather configuration is required to use group chat in multi-bot mode:

1. Send `/mybots` command to @BotFather
2. Select the bot to configure
3. `Bot Settings` → `Allow Groups?` → `Turn groups on`
4. (Optional) `Group Privacy` → `Turn off` — Allows the bot to see all messages in the group

**Note**: OpenCode-Go only processes @mentioned messages by default, so you don't need to turn off Group Privacy.

## Troubleshooting

If the bot doesn't respond when you send a message, check the following:
- Verify that your ID is correctly included in the `ALLOWED_USER_IDS` environment variable. For security, the bot silently ignores messages from unauthorized users.
- For group chats, ensure `GROUP_CHAT_ENABLED=true` is set.
- Verify that `Allow Groups?` is enabled in BotFather.
