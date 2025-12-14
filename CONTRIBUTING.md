# Contributing to Local GPT for Obsidian

Thank you for your interest in contributing to the Local GPT plugin! This guide will help you get started with development.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Project Structure](#project-structure)
- [Building for Production](#building-for-production)
- [Debugging in Obsidian](#debugging-in-obsidian)
- [Submitting Changes](#submitting-changes)

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher
- **Obsidian**: Latest version (for testing)
- **Git**: For version control

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/pfrankov/obsidian-local-gpt.git
cd obsidian-local-gpt
```

### 2. Install Dependencies

```bash
npm install
```

This will install all the necessary dependencies for development.

### 3. Verify Installation

Run the following command to ensure everything is set up correctly:

```bash
npm run check
```

This runs the linter, type checker, and tests.

## Development Workflow

### Watch Mode for Development

To start development with automatic rebuilding on file changes:

```bash
npm run dev
```

This will watch for changes in your source files and automatically rebuild the plugin.

### Type Checking

The project uses TypeScript. To check for type errors:

```bash
npm run typecheck
```

### Linting

To check code style and potential issues:

```bash
npm run lint
```

### Formatting

To automatically format your code:

```bash
npm run format
```

Note: This project has a pre-commit hook that automatically formats code before commits.

## Testing

### Run Tests

To run all tests:

```bash
npm test
```

### Run Tests with Coverage

The test script already includes coverage by default:

```bash
npm test
```

### Run Tests in Watch Mode

For development, you can run tests in watch mode using vitest directly:

```bash
npx vitest
```

## Code Quality

Before submitting your changes, make sure they pass all checks:

```bash
npm run check
```

This command runs:
- ESLint (code linting)
- TypeScript type checking
- All tests with coverage

For a comprehensive check that also formats code and builds the plugin:

```bash
npm run full-check
```

This command runs:
- Prettier (code formatting)
- TypeScript type checking and build
- All tests with coverage

## Project Structure

```
obsidian-local-gpt/
├── src/                    # Source code
│   ├── main.ts            # Main plugin entry point
│   ├── ui/                # UI components (Svelte)
│   ├── processors/        # File processors (e.g., PDF)
│   ├── pwa/               # PWA Creator functionality
│   ├── i18n/              # Internationalization
│   └── types/             # TypeScript type definitions
├── tests/                 # Test files
├── docs/                  # Documentation
│   ├── pwa-creator.md    # PWA Creator documentation
│   └── prompt-templating.md  # Prompt templating guide
├── styles.css             # Plugin styles
├── manifest.json          # Plugin manifest
├── package.json           # Node.js dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── esbuild.config.mjs     # Build configuration
└── vitest.config.mts      # Test configuration
```

## Building for Production

To create a production build:

```bash
npm run build
```

This will:
1. Run type checking
2. Run Svelte checks
3. Bundle the code into `main.js`

The output files will be in the `dist/` directory:
- `dist/main.js` - Bundled plugin code
- `dist/manifest.json` - Plugin manifest
- `dist/styles.css` - Plugin styles

These files are what gets distributed to users.

## Debugging in Obsidian

### Development Installation

To test your changes in Obsidian:

1. **Build the plugin:**
   ```bash
   npm run build
   ```

2. **Copy to Obsidian plugins folder:**
   
   - **macOS/Linux:**
     ```bash
     # Create symbolic link (recommended for development)
     ln -s "$(pwd)/dist" "/path/to/your/vault/.obsidian/plugins/obsidian-local-gpt"
     ```
   
   - **Windows:**
     ```cmd
     # Create symbolic link
     mklink /D "%USERPROFILE%\path\to\vault\.obsidian\plugins\obsidian-local-gpt" "%CD%\dist"
     ```
   
   Or manually copy the files from the `dist/` folder to:
   ```
   /path/to/your/vault/.obsidian/plugins/obsidian-local-gpt/
   ```

3. **Enable the plugin in Obsidian:**
   - Open Obsidian Settings
   - Go to Community plugins
   - Enable "Local GPT"

4. **Reload Obsidian** after making changes:
   - Use the command palette (`Ctrl/Cmd + P`)
   - Search for "Reload app without saving"

### Using Development Mode

When testing with `npm run dev`:
1. The plugin will rebuild automatically when you change files
2. Reload Obsidian to see your changes
3. Check the Developer Console (`Ctrl/Cmd + Shift + I`) for errors

## Submitting Changes

### Before You Submit

1. **Run all checks:**
   ```bash
   npm run full-check
   ```

2. **Test your changes thoroughly** in Obsidian

3. **Update documentation** if you've added or changed features

4. **Write meaningful commit messages:**
   ```
   feat: Add new feature
   fix: Fix bug in component
   docs: Update documentation
   test: Add tests for feature
   refactor: Improve code structure
   ```

### Pull Request Process

1. **Fork the repository** and create a new branch from `main`
2. **Make your changes** following the guidelines above
3. **Test your changes** thoroughly
4. **Submit a pull request** with:
   - Clear description of what you've changed
   - Why the change is necessary
   - Any relevant issue numbers
   - Screenshots (if applicable)

### Coding Standards

- Follow the existing code style (use `npm run format` to auto-format)
- Write clear, self-documenting code
- Add comments for complex logic
- Write tests for new features
- Keep functions small and focused
- Use TypeScript types properly (avoid `any` when possible)

## Additional Resources

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian API Documentation](https://github.com/obsidianmd/obsidian-api)
- [PWA Creator Documentation](docs/pwa-creator.md)
- [Prompt Templating Guide](docs/prompt-templating.md)

## Getting Help

If you need help or have questions:

- Check existing [issues](https://github.com/pfrankov/obsidian-local-gpt/issues)
- Join the [discussions](https://github.com/pfrankov/obsidian-local-gpt/discussions)
- Read the [documentation](docs/)

## License

By contributing to this project, you agree that your contributions will be licensed under the same license as the project (MIT License).

## Thank You!

Your contributions help make this plugin better for everyone. Thank you for taking the time to contribute!
