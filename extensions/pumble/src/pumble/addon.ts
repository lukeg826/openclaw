import { setup } from "pumble-sdk";
import type { Addon, AddonManifest, CredentialsStore } from "pumble-sdk";
import type { ResolvedPumbleAccount } from "./accounts.js";

/**
 * Build a pumble-sdk AddonManifest from an OpenClaw Pumble account config.
 *
 * Requires appId, appKey, clientSecret, and signingSecret to be present.
 *
 * When `webhookPort` is set in the account config, the addon runs in HTTP
 * webhook mode (socketMode: false) — used behind a WebSocket broadcaster
 * that forwards events to localhost. Otherwise, uses direct WebSocket mode.
 */
export function buildPumbleManifest(account: ResolvedPumbleAccount): AddonManifest {
  if (!account.appId?.trim()) {
    throw new Error("Pumble appId is required for SDK mode");
  }
  if (!account.appKey?.trim()) {
    throw new Error("Pumble appKey is required for SDK mode");
  }
  if (!account.clientSecret?.trim()) {
    throw new Error("Pumble clientSecret is required for SDK mode");
  }
  if (!account.signingSecret?.trim()) {
    throw new Error("Pumble signingSecret is required for SDK mode");
  }

  const useWebhookMode = typeof account.config.webhookPort === "number";

  return {
    id: account.appId.trim(),
    socketMode: !useWebhookMode,
    appKey: account.appKey.trim(),
    clientSecret: account.clientSecret.trim(),
    signingSecret: account.signingSecret.trim(),
    shortcuts: [] as const,
    slashCommands: [] as const,
    dynamicMenus: [] as const,
    redirectUrls: [],
    eventSubscriptions: {
      url: useWebhookMode ? "/hook" : "",
      events: ["NEW_MESSAGE" as const, "REACTION_ADDED" as const, "UPDATED_MESSAGE" as const],
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
        "files:write",
      ],
      userScopes: [],
    },
  };
}

/**
 * Create a pumble-sdk Addon instance wired with an OcCredentialsStore.
 *
 * When `webhookPort` is configured, runs in HTTP webhook mode on that port
 * (for use behind a WebSocket broadcaster). Otherwise, connects directly
 * to Pumble via WebSocket.
 */
export function createPumbleAddon(
  account: ResolvedPumbleAccount,
  credentialsStore: CredentialsStore,
): Addon {
  const manifest = buildPumbleManifest(account);
  const port = account.config.webhookPort ?? 0;
  return setup(manifest, {
    serverPort: port,
    oauth2Config: {
      tokenStore: credentialsStore,
    },
  });
}
