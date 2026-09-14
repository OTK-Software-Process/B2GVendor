import { VertexAI } from '@google-cloud/vertexai';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AiProvider } from './types';

let client: VertexAI | null = null;

function getClient(): VertexAI | null {
  if (!env.GOOGLE_CLOUD_PROJECT) {
    logger.warn('vertexAi', 'AI_PROVIDER=vertexai but GOOGLE_CLOUD_PROJECT is not set -- skipping AI analysis');
    return null;
  }
  if (!client) {
    client = new VertexAI({ project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION });
  }
  return client;
}

export const vertexProvider: AiProvider = {
  name: 'vertexai',

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const vertexAi = getClient();
    if (!vertexAi) return '';

    const model = vertexAi.getGenerativeModel({
      model: env.VERTEX_AI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: { temperature: 0, maxOutputTokens: 512 }
    });

    const result = await model.generateContent(userPrompt);
    return result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
};
