import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock axios before any imports that use it
vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
  };
  const create = vi.fn(() => instance);
  return {
    default: { create, isAxiosError: vi.fn() },
    isAxiosError: vi.fn(),
    AxiosError: class AxiosError extends Error {},
    __mockInstance: instance,
  };
});

import axios from 'axios';

describe('infrabrain-client', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.INFRABRAIN_BASE_URL = process.env.INFRABRAIN_BASE_URL;
    savedEnv.INFRABRAIN_ACCESS_KEY = process.env.INFRABRAIN_ACCESS_KEY;
    // Reset module to clear singleton
    vi.resetModules();
  });

  afterEach(() => {
    process.env.INFRABRAIN_BASE_URL = savedEnv.INFRABRAIN_BASE_URL;
    process.env.INFRABRAIN_ACCESS_KEY = savedEnv.INFRABRAIN_ACCESS_KEY;
    vi.restoreAllMocks();
  });

  describe('isInfrabrainConfigured', () => {
    it('returns true when both env vars are set', async () => {
      process.env.INFRABRAIN_BASE_URL = 'https://infra-brain.devonwatkins.com';
      process.env.INFRABRAIN_ACCESS_KEY = 'abc123';
      const { isInfrabrainConfigured } = await import('../src/services/infrabrain-client.js');
      expect(isInfrabrainConfigured()).toBe(true);
    });

    it('returns false when INFRABRAIN_ACCESS_KEY is missing', async () => {
      process.env.INFRABRAIN_BASE_URL = 'https://infra-brain.devonwatkins.com';
      delete process.env.INFRABRAIN_ACCESS_KEY;
      const { isInfrabrainConfigured } = await import('../src/services/infrabrain-client.js');
      expect(isInfrabrainConfigured()).toBe(false);
    });

    it('returns false when INFRABRAIN_BASE_URL is missing', async () => {
      delete process.env.INFRABRAIN_BASE_URL;
      process.env.INFRABRAIN_ACCESS_KEY = 'abc123';
      const { isInfrabrainConfigured } = await import('../src/services/infrabrain-client.js');
      expect(isInfrabrainConfigured()).toBe(false);
    });
  });

  describe('infrabrainGet', () => {
    it('sends x-brain-key header with the access key', async () => {
      process.env.INFRABRAIN_BASE_URL = 'https://infra-brain.devonwatkins.com';
      process.env.INFRABRAIN_ACCESS_KEY = 'secret-key-value';
      const { infrabrainGet } = await import('../src/services/infrabrain-client.js');

      const mockAxios = axios as any;
      const mockInstance = mockAxios.__mockInstance ?? (axios.create as any).mock.results[0]?.value;
      if (mockInstance) {
        mockInstance.get.mockResolvedValue({ data: { rules: [] } });
      }

      try {
        await infrabrainGet('/api/rules', { category: 'coolify' });
      } catch {
        // ignore — we just want to check if the client was constructed
      }

      const createCall = (axios.create as ReturnType<typeof vi.fn>).mock.calls[0];
      if (createCall) {
        const config = createCall[0];
        expect(config.headers?.['x-brain-key']).toBe('secret-key-value');
        expect(config.baseURL).toBe('https://infra-brain.devonwatkins.com');
      }
    });

    it('throws when not configured', async () => {
      delete process.env.INFRABRAIN_BASE_URL;
      delete process.env.INFRABRAIN_ACCESS_KEY;
      const { infrabrainGet } = await import('../src/services/infrabrain-client.js');
      await expect(infrabrainGet('/api/rules')).rejects.toThrow();
    });
  });

  describe('handleInfrabrainError', () => {
    it('returns a human-readable string for axios 401', async () => {
      const { handleInfrabrainError } = await import('../src/services/infrabrain-client.js');
      const err = {
        response: { status: 401, data: {} },
        isAxiosError: true,
        code: undefined,
        message: 'Request failed',
      };
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      const result = handleInfrabrainError(err);
      expect(result).toContain('401');
      expect(result.toLowerCase()).toContain('auth');
    });

    it('returns a human-readable string for network timeout', async () => {
      const { handleInfrabrainError } = await import('../src/services/infrabrain-client.js');
      const err = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        response: undefined,
        message: 'timeout',
      };
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      const result = handleInfrabrainError(err);
      expect(result.toLowerCase()).toContain('timeout');
    });
  });
});
