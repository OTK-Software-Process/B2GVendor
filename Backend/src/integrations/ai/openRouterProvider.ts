import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AiProvider } from './types';

// OpenRouter (https://openrouter.ai) exposes an OpenAI-compatible
// chat-completions endpoint in front of many hosted models -- one API key,
// swap models by name via OPENROUTER_MODEL, no extra SDK dependency needed.
interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export const openRouterProvider: AiProvider = {
  name: 'openrouter',

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!env.OPENROUTER_API_KEY) {
      logger.warn('openRouter', 'AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set -- skipping AI analysis');
      return '';
    }

    const res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        temperature: 0,
        // A reasoning-capable model (e.g. Qwen3.5) spends a large, VARIABLE
        // chunk of its own output budget on the <think> block before the
        // actual JSON answer -- 512 was tuned for a plain non-reasoning
        // completion and was getting exhausted mid-reasoning every time,
        // truncating the response before the model ever reached its answer.
        // Confirmed live: reasoning length isn't stable even at
        // temperature 0 -- repeated identical calls used anywhere from ~500
        // to 2000+ output tokens on reasoning alone before answering, so
        // even a 4096 cap still truncated a real run occasionally. Generous
        // headroom costs little -- this provider is billed per token
        // actually generated, not per max_tokens -- but does NOT fully
        // eliminate the risk; see integrations/ai/index.ts's stripReasoning.
        max_tokens: 8192,
        // Reasoning-capable models (e.g. Qwen3.5) otherwise prepend a
        // <think>...</think> chain-of-thought block to `content` -- that
        // text often contains its own stray '{'/'}' characters, which broke
        // response parsing (parseResult's brace-matching regex grabbed from
        // a brace inside the reasoning through to the real JSON's closing
        // brace, producing garbage that failed JSON.parse on every call).
        // Excluding reasoning tokens also keeps completion-token usage down.
        reasoning: { exclude: true },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const json = (await res.json()) as OpenRouterResponse;
    if (!res.ok) {
      throw new Error(`OpenRouter request failed (HTTP ${res.status}): ${json.error?.message ?? JSON.stringify(json)}`);
    }

    return json.choices?.[0]?.message?.content ?? '';
  }
};
