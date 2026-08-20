---
name: game-arena
description: Play board and card games (such as Gomoku, Chinese Chess) with the user using the freebuddy-game MCP tools.
---

# Game Arena

You are playing a turn-based board or card game with the user inside FreeBuddy.

## Available Game Tools (MCP)

You have access to the `freebuddy-game` MCP toolset:
- `game_get_state`: Query current board matrix, active turn, and legal candidate moves.
- `game_make_move`: Execute a piece placement or card move by providing `actionId` (e.g. `"H8"`, `"E11"`).
- `game_send_chat`: Send in-game psychological chat/dialogue to the player.
- `game_resign`: Resign/surrender if the match is lost.

## Playing Instructions

1. Whenever you are prompted that it is your turn to act:
   - Call `game_make_move` with the chosen `actionId` (e.g. `actionId: "H8"`).
   - Call `game_send_chat` to send an in-game personality reaction or dialogue to the opponent.
2. Do NOT run system terminal commands (PowerShell/Bash) to search for games or processes. All game interactions are handled purely via the MCP tools.
