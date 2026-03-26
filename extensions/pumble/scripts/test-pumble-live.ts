#!/usr/bin/env bun
/**
 * Pumble live integration test — starts the pumble-sdk addon in WebSocket
 * (socket) mode and echoes messages.
 *
 * This is a minimal echo bot that proves the full WebSocket round-trip works:
 *   1. Connect to Pumble via WebSocket (socket mode)
 *   2. Listen for NEW_MESSAGE / REACTION_ADDED / UPDATED_MESSAGE events
 *   3. Echo each message back to the same channel
 *
 * Usage:
 *   bun extensions/pumble/scripts/test-pumble-live.ts
 *
 * Reads credentials from ~/.openclaw/openclaw.json → channels.pumble.
 * Override with env vars: PUMBLE_APP_ID, PUMBLE_APP_KEY, etc.
 *
 * Times out after 600s. Send a message to the bot in Pumble to verify.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk";
import { setup } from "pumble-sdk";
import type { AddonManifest, CredentialsStore, OAuth2AccessTokenResponse } from "pumble-sdk";

const PUMBLE_API = "https://api-ga.pumble.com";
const TIMEOUT_MS = Number(process.env.PUMBLE_LIVE_TIMEOUT) || 600_000;

// ── Credential loading ──────────────────────────────────────────────

type Creds = {
  appId: string;
  appKey: string;
  clientSecret: string;
  signingSecret: string;
  botToken: string;
};

function loadCredentials(): Creds {
  if (process.env.PUMBLE_BOT_TOKEN) {
    return {
      appId: process.env.PUMBLE_APP_ID ?? "",
      appKey: process.env.PUMBLE_APP_KEY ?? "",
      clientSecret: process.env.PUMBLE_APP_CLIENT_SECRET ?? "",
      signingSecret: process.env.PUMBLE_APP_SIGNING_SECRET ?? "",
      botToken: process.env.PUMBLE_BOT_TOKEN,
    };
  }

  const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const raw = readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    const p = cfg?.channels?.pumble ?? {};
    return {
      appId: p.appId ?? "",
      appKey: p.appKey ?? "",
      clientSecret: p.clientSecret ?? "",
      signingSecret: p.signingSecret ?? "",
      botToken: p.botToken ?? "",
    };
  } catch (err) {
    console.error(`Failed to read ${cfgPath}:`, err);
    process.exit(1);
  }
}

// ── Minimal CredentialsStore (same contract as OcCredentialsStore) ──

class TestCredentialsStore implements CredentialsStore {
  private botToken: string;
  private cachedBotUserId: string | undefined;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async initialize(): Promise<void> {}

  async getBotToken(_workspaceId: string): Promise<string | undefined> {
    return this.botToken || undefined;
  }

  async getUserToken(_workspaceId: string, _workspaceUserId: string): Promise<string | undefined> {
    return undefined;
  }

  async getBotUserId(_workspaceId: string): Promise<string | undefined> {
    if (this.cachedBotUserId) return this.cachedBotUserId;
    if (!this.botToken) return undefined;
    try {
      const { response: res, release } = await fetchWithSsrFGuard({
        url: `${PUMBLE_API}/oauth2/me`,
        init: { headers: { token: this.botToken } },
      });
      if (res.ok) {
        const raw = (await res.json()) as { workspaceUserId?: string };
        await release();
        this.cachedBotUserId = raw.workspaceUserId ?? "";
        return this.cachedBotUserId || undefined;
      }
      await release();
    } catch {}
    return undefined;
  }

  async saveTokens(_response: OAuth2AccessTokenResponse): Promise<void> {
    console.log("[store] saveTokens called (ignored in test mode)");
  }

  async deleteForWorkspace(_workspaceId: string): Promise<void> {}
  async deleteForUser(_workspaceUserId: string, _workspaceId: string): Promise<void> {}
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("Pumble Live Integration Test (WebSocket Echo Bot)");
  console.log("=".repeat(50));

  const creds = loadCredentials();

  // Validate credentials
  const missing: string[] = [];
  if (!creds.appId) missing.push("appId");
  if (!creds.appKey) missing.push("appKey");
  if (!creds.clientSecret) missing.push("clientSecret");
  if (!creds.signingSecret) missing.push("signingSecret");
  if (!creds.botToken) missing.push("botToken");
  if (missing.length > 0) {
    console.error(`\nMissing credentials: ${missing.join(", ")}`);
    console.error("Set them in ~/.openclaw/openclaw.json or as environment variables.");
    process.exit(1);
  }

  console.log(`\nappId: ${creds.appId}`);
  console.log(`botToken: ${creds.botToken.slice(0, 20)}...`);

  // Resolve bot user ID so we can ignore our own messages.
  let botUserId: string | undefined;
  try {
    const parts = creds.botToken.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString()) as {
        workspaceUser?: string;
        sub?: string;
      };
      botUserId = payload.workspaceUser?.trim() || payload.sub?.trim();
      if (botUserId) {
        console.log(`Bot user (from JWT): ${botUserId}`);
      }
    }
  } catch {
    // Not a JWT — try API fallback
  }
  if (!botUserId) {
    try {
      const { response: meRes, release: releaseMe } = await fetchWithSsrFGuard({
        url: `${PUMBLE_API}/oauth2/me`,
        init: { headers: { token: creds.botToken } },
      });
      if (meRes.ok) {
        const raw = (await meRes.json()) as {
          workspaceUserId?: string;
          workspaceUserName?: string;
        };
        await releaseMe();
        botUserId = raw.workspaceUserId;
        console.log(
          `Bot user (from API): ${raw.workspaceUserName ?? raw.workspaceUserId ?? "(unknown)"}`,
        );
      } else {
        await releaseMe();
        console.warn(`Warning: /oauth2/me returned ${meRes.status} — cannot filter self-messages`);
      }
    } catch (err) {
      console.warn(`Warning: failed to fetch bot user: ${err}`);
    }
  }

  // Step 1: Build manifest with socket mode enabled
  console.log(`\nStep 1: Building manifest with socketMode=true...`);
  const manifest: AddonManifest = {
    id: creds.appId,
    socketMode: true,
    appKey: creds.appKey,
    clientSecret: creds.clientSecret,
    signingSecret: creds.signingSecret,
    shortcuts: [],
    slashCommands: [],
    dynamicMenus: [],
    redirectUrls: [],
    eventSubscriptions: {
      url: "",
      events: ["NEW_MESSAGE", "REACTION_ADDED", "UPDATED_MESSAGE"],
    },
    scopes: {
      botScopes: [
        "messages:read",
        "messages:write",
        "channels:read",
        "channels:list",
        "user:read",
        "reaction:read",
        "reaction:write",
      ],
      userScopes: [],
    },
  };

  // Step 2: Create addon and register handlers
  console.log(`\nStep 2: Creating addon and registering handlers...`);
  const store = new TestCredentialsStore(creds.botToken);
  // serverPort is required by the SDK type signature but unused in socket mode.
  const addon = setup(manifest, {
    serverPort: 0,
    oauth2Config: { tokenStore: store },
  });

  let messageCount = 0;
  let reactionCount = 0;

  // Register NEW_MESSAGE handler
  addon.message("NEW_MESSAGE", { match: /.*/, includeBotMessages: false }, async (ctx) => {
    try {
      const body = ctx.payload.body as Record<string, unknown>;
      const senderId = (body.aId as string) ?? "unknown";
      const text = (body.tx as string) ?? "";
      const channelId = (body.cId as string) ?? "";

      // Skip own messages
      if (botUserId && senderId === botUserId) {
        return;
      }

      messageCount++;
      const sys = body.sys as boolean | undefined;
      console.log(`\n>>> Message #${messageCount}:`);
      console.log(`  From:    ${senderId}`);
      console.log(`  Channel: ${channelId}`);
      console.log(`  System:  ${sys ?? false}`);
      console.log(`  Text:    ${text.slice(0, 200)}`);

      // Log file attachments
      const files = body.f as Array<Record<string, unknown>> | undefined;
      if (files && files.length > 0) {
        console.log(`  Files:   ${files.length} attachment(s)`);
        for (const file of files) {
          console.log(
            `    - name: ${file.n ?? file.name ?? "?"}, type: ${file.mt ?? file.mimeType ?? "?"}, id: ${file.id ?? "?"}`,
          );
          console.log(`    - keys: ${Object.keys(file).join(", ")}`);
        }
      }

      // Filter system messages
      if (sys === true) {
        console.log(`  DROPPED: system message (join/leave/topic change)`);
        return;
      }

      // Show what normalizeMention would produce
      const { normalizeMention } = await import("../src/pumble/monitor-helpers.js");
      const stripped = normalizeMention(text, undefined, botUserId);
      if (stripped !== text.trim()) {
        console.log(`  Normalized: ${stripped.slice(0, 200)}`);
      }

      // Echo back via REST API
      if (channelId && text) {
        const echoText = `[ws echo] ${text}`;
        try {
          const echoHeaders: Record<string, string> = {
            token: creds.botToken,
            "Content-Type": "application/json",
          };
          if (creds.appKey) echoHeaders["x-app-token"] = creds.appKey;
          const { response: res, release: releaseEcho } = await fetchWithSsrFGuard({
            url: `${PUMBLE_API}/v1/channels/${channelId}/messages`,
            init: {
              method: "POST",
              headers: echoHeaders,
              body: JSON.stringify({ text: echoText }),
            },
          });
          if (res.ok) {
            await releaseEcho();
            console.log(`  Echoed back: "${echoText.slice(0, 80)}"`);
          } else {
            const errBody = await res.text().catch(() => "");
            await releaseEcho();
            console.log(`  Echo failed: HTTP ${res.status} ${errBody.slice(0, 200)}`);
          }
        } catch (err) {
          console.log(`  Echo failed: ${err}`);
        }
      }
    } catch (err) {
      console.error(`  Error processing message:`, err);
    }
  });

  // Register REACTION_ADDED handler
  addon.reaction(/.*/, async (ctx) => {
    try {
      const body = ctx.payload.body as Record<string, unknown>;
      reactionCount++;
      console.log(`\n>>> Reaction #${reactionCount}:`);
      console.log(`  From:    ${body.uId}`);
      console.log(`  Emoji:   ${body.rc}`);
      console.log(`  Message: ${body.mId}`);
    } catch (err) {
      console.error(`  Error processing reaction:`, err);
    }
  });

  // Register UPDATED_MESSAGE handler
  addon.message("UPDATED_MESSAGE", { match: /.*/, includeBotMessages: false }, async (ctx) => {
    const body = ctx.payload.body as Record<string, unknown>;
    console.log(`\n>>> Message edited: ${body.mId} in ${body.cId}`);
  });

  addon.onError((err) => {
    console.error(`\nAddon error:`, err);
  });

  // Step 3: Start the WebSocket connection
  console.log(`\nStep 3: Starting WebSocket connection...`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s — send a message to the bot in Pumble to test.\n`);

  const timeout = setTimeout(() => {
    console.log(`\nTimeout reached (${TIMEOUT_MS / 1000}s).`);
    if (messageCount === 0 && reactionCount === 0) {
      console.log("No events received. Possible causes:");
      console.log("  - App not configured for socket mode in Pumble dashboard");
      console.log("  - Bot not added to any channel");
      console.log("  - No messages sent to the bot during the test window");
    } else {
      console.log(`Received ${messageCount} message(s) and ${reactionCount} reaction(s).`);
    }
    process.exit(messageCount > 0 ? 0 : 1);
  }, TIMEOUT_MS);

  try {
    await addon.start();
    console.log("WebSocket connected — listening for events...\n");
  } catch (err) {
    clearTimeout(timeout);
    console.error(`\nFailed to start addon: ${err}`);
    if (err instanceof Error) {
      console.error(`  Message: ${err.message}`);
      if ("response" in err) {
        const axErr = err as { response?: { status?: number; data?: unknown } };
        console.error(`  Status: ${axErr.response?.status}`);
        console.error(`  Data: ${JSON.stringify(axErr.response?.data)}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
