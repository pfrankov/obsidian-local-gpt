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
    '^./pdf.worker.js$': '<rootDir>/tests/__mocks__/pdf.worker.js'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!pdfjs-dist).+\\.js$'
  ],
};