import Anthropic from "@anthropic-ai/sdk"
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages"
import type {
  ImageBlockParam,
  TextBlockParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages"

export type ClaudeContentBlock = TextBlockParam | ImageBlockParam

export type ClaudeMessage = {
  role: "user" | "assistant"
  content: string | Array<ClaudeContentBlock>
}

const PRIMARY_MODEL = "claude-sonnet-4-6"
const FALLBACK_MODEL = "claude-opus-4-7"

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") {
    return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return /aborted/i.test(msg)
}

async function streamWithModel(
  client: Anthropic,
  model: string,
  systemPrompt: string | Array<TextBlockParam>,
  messages: ClaudeMessage[],
  onToken: (text: string) => void,
): Promise<{ text: string; usage: Usage }> {
  let fullText = ""
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 300_000)
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 16384,
        system: systemPrompt,
        messages,
      },
      { signal: controller.signal },
    )

    for await (const event of stream as AsyncIterable<BetaRawMessageStreamEvent>) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text
        onToken(event.delta.text)
      }
    }

    const finalMessage = await stream.finalMessage()
    const usage = finalMessage.usage as unknown as Usage

    return { text: fullText, usage }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

export async function streamChat(
  apiKey: string,
  systemPrompt: string | Array<TextBlockParam>,
  messages: ClaudeMessage[],
  onToken: (text: string) => void,
  onError: (err: string) => void,
  onComplete: (fullText: string, usage: Usage) => void,
): Promise<void> {
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  })

  try {
    const result = await streamWithModel(client, PRIMARY_MODEL, systemPrompt, messages, onToken)
    onComplete(result.text, result.usage)
  } catch (err) {
    if (isAbortError(err)) {
      onError("Request timed out after 5 minutes. Try a smaller prompt or check the MCP server.")
      return
    }

    const message = err instanceof Error ? err.message : "Unknown error"
    const modelError = /model|not found|invalid/i.test(message)

    if (modelError) {
      try {
        const result = await streamWithModel(
          client,
          FALLBACK_MODEL,
          systemPrompt,
          messages,
          onToken,
        )
        onComplete(result.text, result.usage)
        return
      } catch (fallbackErr) {
        if (isAbortError(fallbackErr)) {
          onError("Request timed out after 5 minutes. Try a smaller prompt or check the MCP server.")
          return
        }
        const fallbackMessage =
          fallbackErr instanceof Error ? fallbackErr.message : "Unknown error"
        onError(fallbackMessage)
        return
      }
    }

    onError(message)
  }
}
