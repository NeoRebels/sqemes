/**
 * SQEM-533 — how each MCP client connects to Sqemes, in one place.
 *
 * Settings → MCP Server used to show ONE JSON snippet labelled "Claude Desktop / Cursor". Every client
 * actually wants something else: Claude and ChatGPT add a connector by URL and sign in, Claude Code and
 * Codex take a command or a TOML table, Cursor and VS Code each have their own JSON shape. Each entry
 * below was read from the client's own documentation on `checkedOn` and links to it, so the day a menu
 * moves, the person can follow the link instead of a stale step.
 *
 * ⚠️ **What is claimed and what is not.** Our server supports OAuth with dynamic client registration
 * (`mcp-oauth`, any https or loopback redirect), so every client that runs OAuth on its own signs in
 * without a key. Where a client's documentation does NOT state that it does (Cursor documents only
 * static client credentials), the entry uses a key from an environment variable instead of promising a
 * sign-in it has not shown. A key never appears in a snippet: it stays in an env var or a password
 * prompt, so a committed config file does not leak it.
 *
 * Pure data, imports nothing — the Settings card and the setup wizard render it, and
 * tests/unit/mcpClients.test.ts reads it without env vars.
 */
export type McpClientId = 'claude' | 'chatgpt' | 'claude-code' | 'codex' | 'cursor' | 'vscode' | 'other';

export interface McpClientGuide {
  id: McpClientId;
  label: string;
  /** The client's own documentation for adding an MCP server. */
  docsUrl: string;
  /** When the steps were last checked against `docsUrl` (YYYY-MM-DD). */
  checkedOn: string;
  /** `oauth`: the client signs in on its own. `key`: it needs a Sqemes key. */
  auth: 'oauth' | 'key';
  steps: string[];
  /** A file or command to copy, with the endpoint filled in. */
  snippet?: (url: string) => { label: string; code: string };
  note?: string;
  /**
   * SQEM-554 (c) — the client's logo as a `ProviderIcon` key, and whether it is single-colour
   * (`currentColor`, rendered black in an `<img>`, so inverted in dark mode). Absent for VS Code (no
   * logo in the package we draw from, assets/ICONS-LICENSE.md) and "Other": the guide shows a neutral
   * icon for those rather than a logo from an unchecked source.
   */
  logo?: { icon: string; mono?: boolean };
}

/** The env var the key-based snippets read, named once so every snippet agrees. */
export const MCP_KEY_ENV = 'SQEMES_MCP_KEY';

const CHECKED = '2026-10-19';

export const MCP_CLIENTS: readonly McpClientGuide[] = [
  {
    id: 'claude',
    logo: { icon: 'claude' },
    label: 'Claude',
    docsUrl: 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
    checkedOn: CHECKED,
    auth: 'oauth',
    steps: [
      'In Claude (web or desktop app): Customize → Connectors → + Add → Add custom connector.',
      'Name it "sqemes" and paste the endpoint URL above. Continue.',
      'Choose to sign in, then sign in with your sqemes account and pick the workspace.',
    ],
    note: 'On Claude Team or Enterprise an owner adds the connector once under Organization settings → Connectors → Add → Custom → Web; everyone then connects it under Customize → Connectors.',
  },
  {
    id: 'chatgpt',
    logo: { icon: 'openai', mono: true },
    label: 'ChatGPT',
    docsUrl: 'https://developers.openai.com/apps-sdk/deploy/connect-chatgpt',
    checkedOn: CHECKED,
    auth: 'oauth',
    steps: [
      'Open chatgpt.com/plugins, select the plus button, then Add custom MCP server.',
      'Name it "sqemes" and paste the endpoint URL above.',
      'Sign in with your sqemes account when ChatGPT asks.',
    ],
    note: 'Your ChatGPT workspace’s policies decide whether custom MCP servers are allowed; on a business plan an admin may have to enable it.',
  },
  {
    id: 'claude-code',
    logo: { icon: 'claudecode', mono: true },
    label: 'Claude Code',
    docsUrl: 'https://code.claude.com/docs/en/mcp',
    checkedOn: CHECKED,
    auth: 'oauth',
    steps: [
      'Run the command below in your terminal.',
      'In Claude Code, run /mcp, choose sqemes and sign in with your sqemes account.',
    ],
    snippet: (url) => ({ label: 'Terminal', code: `claude mcp add --transport http sqemes ${url}` }),
    note: 'Add --scope user to use it in every project. Without a browser, add --header "Authorization: Bearer $SQEMES_MCP_KEY" with a key instead.',
  },
  {
    id: 'codex',
    logo: { icon: 'codex', mono: true },
    label: 'Codex',
    docsUrl: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    checkedOn: CHECKED,
    auth: 'oauth',
    steps: [
      'Add the table below to ~/.codex/config.toml.',
      'Run codex mcp login sqemes and sign in with your sqemes account.',
    ],
    snippet: (url) => ({ label: '~/.codex/config.toml', code: `[mcp_servers.sqemes]\nurl = "${url}"` }),
    note: `To use a key instead, add bearer_token_env_var = "${MCP_KEY_ENV}" to the table and set that variable.`,
  },
  {
    id: 'cursor',
    logo: { icon: 'cursor', mono: true },
    label: 'Cursor',
    docsUrl: 'https://cursor.com/docs/context/mcp',
    checkedOn: CHECKED,
    auth: 'key',
    steps: [
      'Create a key above and set it as the environment variable SQEMES_MCP_KEY.',
      'Add the block below to ~/.cursor/mcp.json (or .cursor/mcp.json in one project).',
      'Restart Cursor and switch the sqemes server on in its MCP settings.',
    ],
    snippet: (url) => ({
      label: '~/.cursor/mcp.json',
      code: `{\n  "mcpServers": {\n    "sqemes": {\n      "url": "${url}",\n      "headers": {\n        "Authorization": "Bearer \${env:${MCP_KEY_ENV}}"\n      }\n    }\n  }\n}`,
    }),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
    checkedOn: CHECKED,
    auth: 'key',
    steps: [
      'Create a key above.',
      'Add the file below as .vscode/mcp.json in your project (or in your user profile).',
      'Start the server from the file; VS Code asks for the key once and stores it.',
    ],
    snippet: (url) => ({
      label: '.vscode/mcp.json',
      code: `{\n  "inputs": [\n    { "type": "promptString", "id": "sqemes-key", "description": "Sqemes MCP key", "password": true }\n  ],\n  "servers": {\n    "sqemes": {\n      "type": "http",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer \${input:sqemes-key}" }\n    }\n  }\n}`,
    }),
  },
  {
    id: 'other',
    label: 'Other',
    docsUrl: 'https://modelcontextprotocol.io/clients',
    checkedOn: CHECKED,
    auth: 'key',
    steps: [
      'Add the endpoint URL above as a remote (HTTP) MCP server.',
      'If the client offers to sign in, do that. Otherwise send a key as Authorization: Bearer <key>.',
    ],
    snippet: (url) => ({
      label: 'Many clients read this shape',
      code: `{\n  "mcpServers": {\n    "sqemes": {\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer sqm_live_YOUR_KEY" }\n    }\n  }\n}`,
    }),
    note: 'Keep a file that holds a key out of version control.',
  },
];
