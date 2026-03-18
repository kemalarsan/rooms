import {
  BlockStreamingCoalesceSchema,
  DmConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";

const RoomsRoomSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: z.record(z.string(), ToolPolicySchema).optional(),
    skills: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const RoomsAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    apiUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    pollIntervalMs: z.number().int().min(1000).max(60000).optional().default(5000),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    rooms: z.record(z.string(), RoomsRoomSchema.optional()).optional(),
    mentionPatterns: z.array(z.string()).optional(),
    markdown: MarkdownConfigSchema,
    ...ReplyRuntimeConfigSchemaShape,
  })
  .strict();

export const RoomsAccountSchema = RoomsAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.rooms.dmPolicy="open" requires channels.rooms.allowFrom to include "*"',
  });
});

export const RoomsConfigSchema = RoomsAccountSchemaBase.extend({
  accounts: z.record(z.string(), RoomsAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.rooms.dmPolicy="open" requires channels.rooms.allowFrom to include "*"',
  });
});