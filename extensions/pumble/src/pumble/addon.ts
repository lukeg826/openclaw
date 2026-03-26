import { setup } from "pumble-sdk";
import type { Addon, AddonManifest, CredentialsStore } from "pumble-sdk";
import type { ResolvedPumbleAccount } from "./accounts.js";

/**
 * Build a pumble-sdk AddonManifest from an OpenClaw Pumble account config.
 *
 * Requires appId, appKey, clientSecret, and signingSecret to be present.
 * Sets `socketMode: true` so the SDK connects via WebSocket for real-time
 * events — no public URL, tunnel, or HTTP webhook server required.
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

  return {
    id: account.appId.trim(),
    socketMode: true,
    appKey: account.appKey.trim(),
    clientSecret: account.clientSecret.trim(),
    signingSecret: account.signingSecret.trim(),
    shortcuts: [] as const,
    slashCommands: [] as const,
    dynamicMenus: [] as const,
    redirectUrls: [],
    eventSubscriptions: {
      url: "",
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
 * Uses `socketMode: true` — calling `addon.start()` establishes a WebSocket
 * connection to Pumble for real-time event delivery.
 */
export function createPumbleAddon(
  account: ResolvedPumbleAccount,
  credentialsStore: CredentialsStore,
): Addon {
  const manifest = buildPumbleManifest(account);
  // serverPort is required by the SDK type signature but unused in socket mode.
  return setup(manifest, {
    serverPort: 0,
    oauth2Config: {
      tokenStore: credentialsStore,
    },
  });
}
