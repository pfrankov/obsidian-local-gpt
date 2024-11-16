import { OllamaAIProvider } from '../src/providers/ollama';
import { OpenAICompatibleAIProvider } from '../src/providers/openai-compatible';

jest.mock('obsidian', () => ({
  requestUrl: jest.fn(),
}));

describe('AIProviders', () => {
  test('OllamaAIProvider initialization', () => {
    const ollamaProvider = new OllamaAIProvider({
      defaultModel: 'test-model',
      url: 'http://test-ollama-url',
      embeddingModel: 'test-embedding-model',
      onUpdate: jest.fn(),
      abortController: new AbortController(),
    });
    expect(ollamaProvider).toBeDefined();
  });

  test('OpenAICompatibleAIProvider initialization', () => {
    const openAIProvider = new OpenAICompatibleAIProvider({
      url: 'http://test-openai-url',
      apiKey: 'test-api-key',
      defaultModel: 'test-model',
      embeddingModel: 'test-embedding-model',
      abortController: new AbortController(),
      onUpdate: jest.fn(),
    });
    expect(openAIProvider).toBeDefined();
  });
});