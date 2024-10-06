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
	private isDevMode: boolean;
	private timers: Map<string, { startTime: number; color: string }> =
		new Map();
	private colorIndex: number = 0;
	private colors: string[] = [
		"#FFB3BA",
		"#BAFFC9",
		"#BAE1FF",
		"#FFFFBA",
		"#FFDFBA",
		"#E0BBE4",
	];

	private constructor() {
		this.isDevMode = process.env.NODE_ENV === "development";
	}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	setLogLevel(level: LogLevel) {
		this.logLevel = level;
	}

	private logWithEmoji(level: LogLevel, message: string, ...args: any[]) {
		if (this.isDevMode && level >= this.logLevel) {
			const emoji = this.getEmojiForLevel(level);
			if (args.length === 0) {
				console.log(`${emoji} %c${message}`, "font-weight: bold;");
			} else {
				console.group(`${emoji} %c${message}`, "font-weight: bold;");
				this.logArgs(args);
				console.groupEnd();
			}
		}
	}

	private logArgs(args: any[]) {
		args.forEach((arg) => {
			console.log(arg);
		});
	}

	private getEmojiForLevel(level: LogLevel): string {
		switch (level) {
			case LogLevel.DEBUG:
				return "🐛"; // Жук для отладки
			case LogLevel.INFO:
				return "ℹ️"; // Информация
			case LogLevel.WARN:
				return "⚠️"; // Предупреждение
			case LogLevel.ERROR:
				return "🚫"; // Ошибка
			case LogLevel.SUCCESS:
				return "✅"; // Успех
			default:
				return "";
		}
	}

	debug(message: string, ...args: any[]) {
		this.logWithEmoji(LogLevel.DEBUG, message, ...args);
	}

	info(message: string, ...args: any[]) {
		this.logWithEmoji(LogLevel.INFO, message, ...args);
	}

	warn(message: string, ...args: any[]) {
		this.logWithEmoji(LogLevel.WARN, message, ...args);
	}

	error(message: string, ...args: any[]) {
		this.logWithEmoji(LogLevel.ERROR, message, ...args);
	}

	success(message: string, ...args: any[]) {
		this.logWithEmoji(LogLevel.SUCCESS, message, ...args);
	}

	table(message: string, ...args: any[]) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			console.group(`📊 %c${message}`, "font-weight: bold;");
			this.logNestedGroups(args);
			console.groupEnd();
		}
	}

	private logNestedGroups(args: any[]) {
		args.forEach((arg) => {
			if (typeof arg === "object" && arg !== null) {
				this.logObjectAsGroups(arg);
			} else {
				console.log(arg);
			}
		});
	}

	private logObjectAsGroups(obj: object) {
		Object.entries(obj).forEach(([key, value]) => {
			if (typeof value === "object" && value !== null) {
				console.group(`${key}:`);
				this.logObjectAsGroups(value);
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

	// Добавляем новый метод для создания разделителя
	separator(message: string = "") {
		if (this.isDevMode) {
			const lineLength = 20;
			const line = "━".repeat(lineLength);
			const paddedMessage = message ? ` ${message} ` : "";
			const leftPadding = Math.floor(
				(lineLength - paddedMessage.length) / 2,
			);
			const rightPadding =
				lineLength - paddedMessage.length - leftPadding;

			const separatorLine = message
				? line.slice(0, leftPadding) +
					paddedMessage +
					line.slice(lineLength - rightPadding)
				: line;

			console.log(
				"\n%c" + separatorLine,
				"color: #FF4500; font-weight: bold; font-size: 1.2em;",
			);
		}
	}
}

export const logger = Logger.getInstance();
