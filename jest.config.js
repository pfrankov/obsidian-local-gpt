module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['ts', 'js', 'svelte', 'json'],
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.vitest\\.ts$'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  transform: {
    '^.+\\.svelte$': ['svelte-jester', { preprocess: true }],
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    '^../logger.js$': '<rootDir>/tests/__mocks__/logger.ts',
    '^./pdf.worker.js$': '<rootDir>/tests/__mocks__/pdf.worker.js',
    '^defaultSettings$': '<rootDir>/src/defaultSettings.ts'
  },
  // Ignore provider's internal mocks so Jest doesn't treat them as manual mocks and cause duplicates
  modulePathIgnorePatterns: [
    '<rootDir>/obsidian-ai-providers/__mocks__'
  ],
  // Do not transform files under obsidian-ai-providers to avoid ESM parsing in mocks
  transformIgnorePatterns: [
    '/node_modules/(?!pdfjs-dist|svelte).+\\.js$',
    '<rootDir>/obsidian-ai-providers/'
  ],
};
