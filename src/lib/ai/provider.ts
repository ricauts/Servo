// Chat provider abstraction. The engine only ever talks to a ChatProvider;
// getProvider() picks the real Anthropic client (BYOK) or the deterministic
// mock, so every flow works identically with or without an API key.

import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "@/lib/types";
import { MockProvider, type MockContext } from "./mock";
import type { AiSettings } from "./settings";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AssistantTurn {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
}

export interface ChatProvider {
  complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn>;
}

class AnthropicProvider implements ChatProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(settings: AiSettings) {
    this.client = new Anthropic({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined,
    });
    this.model = settings.model;
  }

  async complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn> {
    // Our ConversationMessage[] mirrors the Messages API shape, so it maps
    // directly. No temperature: removed on modern models.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: p.maxTokens ?? 4096,
      system: p.system,
      messages: p.messages as Anthropic.MessageParam[],
      tools: p.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      })),
    });

    let text = "";
    const toolCalls: AssistantTurn["toolCalls"] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return { text, toolCalls };
  }
}

export function getProvider(settings: AiSettings, ctx: MockContext): ChatProvider {
  if (settings.provider === "anthropic" && settings.apiKey) {
    return new AnthropicProvider(settings);
  }
  return new MockProvider(ctx);
}
