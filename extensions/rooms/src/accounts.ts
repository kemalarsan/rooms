import {
  DEFAULT_ACCOUNT_ID,
  listConfiguredAccountIds,
  resolveAccountWithDefaultFallback,
} from "openclaw/plugin-sdk";
import type { CoreConfig, RoomsAccountConfig } from "./types.js";

export type ResolvedRoomsAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: RoomsAccountConfig;
  apiUrl: string;
  apiKey?: string;
  pollIntervalMs: number;
};

function isConfigured(config: RoomsAccountConfig): boolean {
  return Boolean(config.apiUrl?.trim() && config.apiKey?.trim());
}

export function resolveRoomsAccount(params: {
  cfg: CoreConfig;
  accountId?: string;
}): ResolvedRoomsAccount {
  const resolved = resolveAccountWithDefaultFallback({
    sectionConfig: params.cfg.channels?.rooms,
    accountId: params.accountId,
    defaultAccountId: DEFAULT_ACCOUNT_ID,
  });

  const config = resolved.config as RoomsAccountConfig;
  const configured = isConfigured(config);
  const name = resolved.name || resolved.accountId;
  const apiUrl = config.apiUrl?.trim() || "https://rooms-eight-silk.vercel.app";
  const pollIntervalMs = config.pollIntervalMs || 5000;

  return {
    accountId: resolved.accountId,
    name,
    enabled: resolved.enabled,
    configured,
    config,
    apiUrl,
    apiKey: config.apiKey?.trim(),
    pollIntervalMs,
  };
}

export function listRoomsAccountIds(cfg: CoreConfig): string[] {
  return listConfiguredAccountIds(cfg.channels?.rooms);
}

export function resolveDefaultRoomsAccountId(cfg: CoreConfig): string {
  const defaultId = cfg.channels?.rooms?.defaultAccount?.trim();
  return defaultId || DEFAULT_ACCOUNT_ID;
}