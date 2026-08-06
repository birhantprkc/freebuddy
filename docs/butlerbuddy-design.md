# ButlerBuddy Agent design

## Decision

ButlerBuddy is a first-class built-in Agent. It appears in the same picker as Codex, ClaudeCode, and other Agents, starts ordinary persisted conversations, and uses the same message, attachment, permission, handoff, and session infrastructure.

Its distinction is a protected Agent profile:

- visible identity: `ButlerBuddy`
- Agent id: `cli-butlerbuddy`
- initial runtime: `codex-acp`
- default approval mode: `ask`
- required Skill: `butlerbuddy`
- future tool policy: `freebuddy-admin-controlled`

The visible Agent identity and the underlying runtime are intentionally separate. The first implementation uses Codex ACP. A later implementation may resolve an installed runtime automatically, but a conversation must retain the adapter selected when it was created.

## Conversation behavior

ButlerBuddy conversations are not singletons. Users may create, rename, archive, transfer, and resume multiple ButlerBuddy conversations like any other Agent conversation.

The required Skill is merged into the selected Skill set at three boundaries:

1. the Agent defaults shown in the new-task composer;
2. conversation creation in the renderer;
3. conversation creation and Skill updates in the Electron process.

The Electron enforcement prevents a renderer or remote caller from removing the core Skill.

## Capability model

The Skill defines the conversational workflow and safety policy. Application mutations must be implemented as typed, allowlisted tools; the model must never receive raw database access or a generic `settings:set` capability.

| Capability | Example | Confirmation | MVP |
| --- | --- | --- | --- |
| Read application status | list installed Agents and enabled Skills | no | next |
| Explain configuration | explain permission modes | no | next |
| Open a Settings surface | open Plugins settings | no | next |
| Change reversible preferences | theme, language, default Agent | yes | later |
| Manage extensions | install, enable, disable Skill or Plugin | yes | later |
| Authentication | start login or logout | always | later |
| Remote access | enable LAN access or change port | always | later |
| Destructive data operations | delete conversations or credentials | separate explicit flow | out of scope |

## Proposed tool boundary

Add a dedicated `freebuddy-butler` MCP/tool service with narrow schemas:

- `freebuddy_status_get`
- `freebuddy_settings_open`
- `freebuddy_change_prepare`
- `freebuddy_change_apply`
- `freebuddy_change_undo`
- `freebuddy_agent_check`
- `freebuddy_extension_list`
- `freebuddy_extension_change_prepare`

Every mutation should produce a short-lived change token containing the allowlisted operation and a redacted before/after snapshot. Applying a token verifies that it belongs to the current user and has not expired. Secrets must not appear in the token, transcript, telemetry, or audit log.

## Runtime and permissions

The initial profile is powered by Codex ACP because it already supports FreeBuddy Skills and tool sessions. ButlerBuddy defaults to `ask`, even when the underlying Codex Agent defaults to automatic approval.

The profile id, not the system prompt, must control access to Butler tools. Other Agents should receive read-only discovery at most. Tool authorization must validate the conversation owner and `agent_id === cli-butlerbuddy` in the Electron process.

## Delivery phases

### Phase 1: Agent and Skill skeleton

- Add ButlerBuddy to the normal Agent picker.
- Reuse Codex runtime availability while preserving the ButlerBuddy identity.
- Seed the required built-in Skill.
- Lock the required Skill in the composer and enforce it in Electron.

### Phase 2: Read-only butler tools

- Inspect Agents, Skills, Plugins, general preferences, privacy, and remote-access state.
- Deep-link to the relevant Settings section.
- Render structured diagnostic results in the normal conversation.

### Phase 3: Confirmed mutations

- Add prepare/apply/undo change tokens.
- Render configuration-diff confirmation cards.
- Add audit records with redacted values.

### Phase 4: Runtime selection

- Add an `automatic` Butler runtime preference.
- Select the first supported installed ACP Agent for new conversations.
- Persist the chosen adapter on each conversation so existing sessions never switch engines unexpectedly.
