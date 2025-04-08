// --- START OF FILE logger.ts ---

// @ts-ignore - Node.js 'process' might not be available in Obsidian mobile API environment
// Check for existence before accessing
const isNodeEnvironment = typeof process !== 'undefined' && process.env;

enum LogLevel {
	DEBUG,
	INFO,
	WARN,
	ERROR,
	SUCCESS,
}

class Logger {
	private static instance: Logger;
	private logLevel: LogLevel = LogLevel.DEBUG;
	// Default to true if 'process' is unavailable (e.g., mobile), or check NODE_ENV
	private isDevMode: boolean = isNodeEnvironment ? process.env.NODE_ENV === "development" : true;
	private timers: Map<string, { startTime: number; color: string }> = new Map();
	private colorIndex = 0; // ESLint fix: removed : number
	private colors: string[] = [
		"#FFB3BA", "#BAFFC9", "#BAE1FF", "#FFFFBA", "#FFDFBA", "#E0BBE4",
	];

	private constructor() {
		// Allow overriding dev mode check, e.g., based on plugin settings or build flags if needed
	}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	// Call this from your plugin's onload if you want to control log level via settings
	initialize(logLevel: LogLevel = LogLevel.INFO, isDev: boolean = this.isDevMode) {
		this.logLevel = logLevel;
		this.isDevMode = isDev;
		console.log(`[Logger] Initialized. Level: ${LogLevel[logLevel]}, DevMode: ${isDev}`);
	}

	setLogLevel(level: LogLevel) {
		this.logLevel = level;
	}

	private logWithEmoji(level: LogLevel, message: string, ...args: unknown[]) {
		// Only log if in dev mode and the message level is sufficient
		if (this.isDevMode && level >= this.logLevel) {
			const emoji = this.getEmojiForLevel(level);
			// Simple console.log for single messages or non-objects
			if (args.length === 0 || typeof args[0] !== 'object') {
				console.log(`${emoji} %c${message}`, "font-weight: bold;", ...args);
			}
			// Use groups for objects or multiple arguments for better readability
			else {
				console.groupCollapsed(`${emoji} %c${message}`, "font-weight: bold;");
				this.logArgs(args);
				console.groupEnd();
			}
		}
	}

	// Type args explicitly as unknown[]
	private logArgs(args: unknown[]) {
		args.forEach((arg) => {
			console.log(arg);
		});
	}

	private getEmojiForLevel(level: LogLevel): string {
		switch (level) {
			case LogLevel.DEBUG: return "🐛";
			case LogLevel.INFO: return "ℹ️";
			case LogLevel.WARN: return "⚠️";
			case LogLevel.ERROR: return "🚫";
			case LogLevel.SUCCESS: return "✅";
			default: return "";
		}
	}

	// Type args explicitly as unknown[]
	debug(message: string, ...args: unknown[]) {
		this.logWithEmoji(LogLevel.DEBUG, message, ...args);
	}

	// Type args explicitly as unknown[]
	info(message: string, ...args: unknown[]) {
		this.logWithEmoji(LogLevel.INFO, message, ...args);
	}

	// Type args explicitly as unknown[]
	warn(message: string, ...args: unknown[]) {
		this.logWithEmoji(LogLevel.WARN, message, ...args);
	}

	// Type args explicitly as unknown[]
	error(message: string, ...args: unknown[]) {
		this.logWithEmoji(LogLevel.ERROR, message, ...args);
	}

	// Type args explicitly as unknown[]
	success(message: string, ...args: unknown[]) {
		this.logWithEmoji(LogLevel.SUCCESS, message, ...args);
	}

	// Type args explicitly as unknown[]
	table(message: string, ...args: unknown[]) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			console.groupCollapsed(`📊 %c${message}`, "font-weight: bold;");
			this.logNestedGroups(args);
			console.groupEnd();
		}
	}

	// Type args explicitly as unknown[]
	private logNestedGroups(args: unknown[]) {
		args.forEach((arg) => {
			if (typeof arg === "object" && arg !== null) {
				this.logObjectAsGroups(arg as Record<string, unknown>); // Cast to Record
			} else {
				console.log(arg);
			}
		});
	}

	// Type obj explicitly as Record<string, unknown>
	private logObjectAsGroups(obj: Record<string, unknown>) {
		// Check if Object.entries is available (requires ES2017+)
		if (typeof Object.entries !== 'function') {
			console.warn("[Logger] Object.entries not supported in this environment. Cannot log object details.");
			console.log(obj); // Fallback to simple log
			return;
		}
		// Add explicit types for key and value
		Object.entries(obj).forEach(([key, value]: [string, unknown]) => {
			if (typeof value === "object" && value !== null) {
				console.groupCollapsed(`${key}:`); // Use collapsed for deep objects
				this.logObjectAsGroups(value as Record<string, unknown>); // Recursive call
				console.groupEnd();
			} else {
				console.log(`${key}: ${value}`);
			}
		});
	}

	time(label: string) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			const color = this.getNextColor();
			this.timers.set(label, { startTime: performance.now(), color });
			console.log(
				`⏱️ %c${label}: timer started`,
				`color: black; font-weight: bold; background-color: ${color}; padding: 2px 5px; border-radius: 3px;`,
			);
		}
	}

	timeEnd(label: string) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			const timerData = this.timers.get(label);
			if (timerData) {
				const duration = performance.now() - timerData.startTime;
				console.log(
					`⏱️ %c${label}: ${duration.toFixed(2)}ms`,
					`color: black; font-weight: bold; background-color: ${timerData.color}; padding: 2px 5px; border-radius: 3px;`,
				);
				this.timers.delete(label);
			} else {
				console.warn(`Timer '${label}' does not exist`);
			}
		}
	}

	private getNextColor(): string {
		const color = this.colors[this.colorIndex];
		this.colorIndex = (this.colorIndex + 1) % this.colors.length;
		return color;
	}

	separator(message = "") { // ESLint fix: removed : string
		if (this.isDevMode) {
			const lineLength = 50; // Increased length
			const line = "━".repeat(lineLength);
			if (message) {
				const paddedMessage = ` ${message} `;
				const remainingLength = lineLength - paddedMessage.length;
				const leftPadding = Math.max(0, Math.floor(remainingLength / 2));
				const rightPadding = Math.max(0, remainingLength - leftPadding);
				const separatorLine = line.slice(0, leftPadding) + paddedMessage + line.slice(0, rightPadding); // Use slice(0, count)
				console.log(`\n%c${separatorLine}`, "color: #FF4500; font-weight: bold; font-size: 1.1em;");
			} else {
				console.log(`\n%c${line}`, "color: #FF4500; font-weight: bold; font-size: 1.1em;");
			}
			console.log(""); // Add extra newline for spacing
		}
	}
}

export const logger = Logger.getInstance();

// --- END OF FILE logger.ts ---