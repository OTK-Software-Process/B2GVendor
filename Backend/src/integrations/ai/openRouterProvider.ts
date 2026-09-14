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
        max_tokens: 512,
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
