import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { resolveRedisUrl } from "@midday/cache/shared-redis";
import { isLocalDesktopRuntime } from "@midday/utils/envs";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";

export function createMiddayBot() {
  return new Chat({
    userName: "midday",
    adapters: {
      whatsapp: createWhatsAppAdapter(),
      telegram: createTelegramAdapter(),
      slack: createSlackAdapter(),
      sendblue: createSendblueAdapter(),
    },
    state: createRedisState({ url: resolveRedisUrl() }),
    concurrency: {
      strategy: "debounce",
      debounceMs: 1500,
    },
  });
}

function createLocalBot(): ReturnType<typeof createMiddayBot> {
  const registerHandler = () => {};
  const webhook = async () => new Response(null, { status: 204 });

  return {
    getAdapter: () => null,
    initialize: async () => {},
    onAssistantContextChanged: registerHandler,
    onAssistantThreadStarted: registerHandler,
    onNewMention: registerHandler,
    onNewMessage: registerHandler,
    onSubscribedMessage: registerHandler,
    webhooks: {
      sendblue: webhook,
      slack: webhook,
      telegram: webhook,
      whatsapp: webhook,
    },
  } as unknown as ReturnType<typeof createMiddayBot>;
}

export const bot = isLocalDesktopRuntime() ? createLocalBot() : createMiddayBot();
