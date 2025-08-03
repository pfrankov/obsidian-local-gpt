module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    '^../logger.js$': '<rootDir>/tests/__mocks__/logger.ts',
    '^./pdf.worker.js$': '<rootDir>/tests/__mocks__/pdf.worker.js',
    // Map idb to our ESM-safe mock to avoid ESM issues from obsidian-ai-providers mocks
    '^idb$': '<rootDir>/obsidian-ai-providers/__mocks__/idb.js'
  },
  // Ignore provider's internal mocks so Jest doesn't treat them as manual mocks and cause duplicates
  modulePathIgnorePatterns: [
    '<rootDir>/obsidian-ai-providers/__mocks__'
  ],
  // Do not transform files under obsidian-ai-providers to avoid ESM parsing in mocks
  transformIgnorePatterns: [
    '/node_modules/(?!pdfjs-dist).+\\.js$',
    '<rootDir>/obsidian-ai-providers/'
  ],
};