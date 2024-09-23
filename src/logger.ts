enum LogLevel {
	DEBUG,
	INFO,
	WARN,
	ERROR,
}

class Logger {
	private static instance: Logger;
	private logLevel: LogLevel = LogLevel.DEBUG;
	private isDevMode: boolean;

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

	private log(level: LogLevel, message: string, ...args: any[]) {
		if (this.isDevMode && level >= this.logLevel) {
			if (args.length > 0) {
				console.group(message);
				args.forEach((arg) => {
					console.log(arg);
				});
				console.groupEnd();
			}
		}
	}

	debug(message: string, ...args: any[]) {
		this.log(LogLevel.DEBUG, message, ...args);
	}

	info(message: string, ...args: any[]) {
		this.log(LogLevel.INFO, message, ...args);
	}

	warn(message: string, ...args: any[]) {
		this.log(LogLevel.WARN, message, ...args);
	}

	error(message: string, ...args: any[]) {
		console.error(message, ...args);
	}

	time(label: string) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			console.time(label);
		}
	}

	timeEnd(label: string) {
		if (this.isDevMode && this.logLevel <= LogLevel.DEBUG) {
			console.timeEnd(label);
		}
	}
}

export const logger = Logger.getInstance();
