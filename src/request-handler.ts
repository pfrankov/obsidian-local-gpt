// --- START OF FILE request-handler.ts ---

// @ts-ignore - Electron 'remote' module might not exist or be typed correctly
import { remote } from "electron";
// Import types if @types/electron is installed
import type { ClientRequest, IncomingMessage } from 'electron';

import { logger } from "./logger";
import { Platform } from "obsidian"; // Assuming 'obsidian' types are available

type RequestOptions = {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string | Buffer; // Allow Buffer for binary data
	abortController: AbortController;
};

type ResponseHandler = {
	onData: (chunk: string) => void; // Handler for each data chunk (string)
	onError: (error: Error) => void; // Handler for errors
	onEnd: () => void; // Handler for when the response finishes
};

/**
 * Handles making HTTP requests, attempting to use Electron's `net` module on desktop
 * and falling back to `fetch` on mobile or if `remote.net` is unavailable.
 * NOTE: This might be unused if all requests go through the AI Providers SDK.
 */
export class RequestHandler {
	private static instance: RequestHandler;
	private useElectronNet: boolean;

	private constructor() {
		// Check if running on desktop AND electron 'remote' and 'net' modules are available and functional
		this.useElectronNet = false; // Default to false
		if (Platform.isDesktopApp) {
			try {
				// Verify that remote.net.request exists and is a function
				if (typeof remote?.net?.request === 'function') {
					this.useElectronNet = true;
				} else {
					logger.warn("Electron 'remote.net.request' not available or not a function.");
				}
			} catch (e) {
				logger.warn("Error checking for Electron 'remote' module. Falling back to fetch.", e);
			}
		}
		logger.info(`RequestHandler initialized. Using ${this.useElectronNet ? 'Electron net' : 'fetch'} for requests.`);
	}

	static getInstance(): RequestHandler {
		if (!RequestHandler.instance) {
			RequestHandler.instance = new RequestHandler();
		}
		return RequestHandler.instance;
	}

	/**
	 * Makes an HTTP request using the appropriate method (Electron net or fetch).
	 */
	async makeRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		logger.debug(`Making request: ${options.method} ${options.url}`);
		try {
			if (this.useElectronNet) {
				await this.makeElectronNetRequest(options, handlers);
			} else {
				await this.makeFetchRequest(options, handlers);
			}
		} catch (error) {
			logger.error("Error initiating request:", error);
			handlers.onError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	// --- Electron net Request Implementation ---
	private async makeElectronNetRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		// Ensure remote.net.request actually exists before calling it
		if (typeof remote?.net?.request !== 'function') {
			throw new Error("Electron net API is unavailable.");
		}

		return new Promise<void>((resolve, reject) => {
			let request: ClientRequest | null = null;
			try {
				// Explicitly type the request variable using imported Electron types
				request = remote.net.request({
					method: options.method,
					url: options.url,
				});
			} catch (initError) {
				logger.error("Failed to create Electron net request:", initError);
				handlers.onError(initError instanceof Error ? initError : new Error(String(initError)));
				reject(initError);
				return;
			}

			// Null check (shouldn't happen if try/catch worked, but belts and suspenders)
			if (!request) {
				const nullReqError = new Error("Electron net request object is unexpectedly null after creation.");
				handlers.onError(nullReqError); reject(nullReqError); return;
			}
			const req: ClientRequest = request; // Use non-null req from here

			const { signal } = options.abortController;
			if (signal.aborted) { /* ... handle pre-aborted ... */ reject(new Error("Request aborted before starting")); return; }

			const onAbort = () => {
				const abortError = new Error("Request aborted");
				logger.warn(abortError.message, { url: options.url });
				try { req.abort(); } catch (e) { logger.warn("Error during req.abort():", e); }
				handlers.onError(abortError);
				reject(abortError);
			};
			signal.addEventListener("abort", onAbort, { once: true });

			// Set Headers
			if (options.headers) {
				// Use Object.entries if available (ES2017+)
				if (typeof Object.entries === 'function') {
					for (const [key, value] of Object.entries(options.headers)) {
						try { req.setHeader(key, value); } catch (e) { logger.warn(`Failed to set header "${key}":`, e); }
					}
				} else {
					// Fallback for older environments
					for (const key in options.headers) {
						if (Object.prototype.hasOwnProperty.call(options.headers, key)) {
							try { req.setHeader(key, options.headers[key]); } catch (e) { logger.warn(`Failed to set header "${key}":`, e); }
						}
					}
				}
			}

			// Response Handling
			req.on("response", (response: IncomingMessage) => {
				logger.debug(`Response received: ${response.statusCode} ${response.statusMessage}`, { url: options.url });

				if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
					let errorBody = '';
					// Type chunk as Buffer (requires @types/node)
					response.on('data', (chunk: Buffer) => { errorBody += chunk.toString('utf8'); });
					response.on('end', () => {
						const statusError = new Error(`Request failed: ${response.statusCode} ${response.statusMessage}${errorBody ? `\nBody: ${errorBody.substring(0, 500)}` : ''}`);
						signal.removeEventListener("abort", onAbort);
						handlers.onError(statusError);
						reject(statusError);
					});
					return;
				}

				// Data Streaming
				response.on("data", (chunk: Buffer) => { // Type chunk as Buffer
					if (signal.aborted) return;
					try { handlers.onData(chunk.toString("utf8")); }
					catch (dataError) {
						logger.error("Error in onData handler:", dataError);
						try { req.abort(); } catch(e) {/* ignore */}
						signal.removeEventListener("abort", onAbort);
						handlers.onError(dataError instanceof Error ? dataError : new Error(String(dataError)));
						reject(dataError);
					}
				});

				// Response End
				response.on("end", () => {
					if (signal.aborted) return;
					logger.debug("Response stream ended.", { url: options.url });
					signal.removeEventListener("abort", onAbort);
					try { handlers.onEnd(); resolve(); }
					catch (endError) {
						logger.error("Error in onEnd handler:", endError);
						handlers.onError(endError instanceof Error ? endError : new Error(String(endError)));
						reject(endError);
					}
				});

				// Response Error
				response.on('error', (error: Error) => {
					if (signal.aborted) return;
					logger.error('Response stream error:', error, { url: options.url });
					signal.removeEventListener("abort", onAbort);
					handlers.onError(error);
					reject(error);
				});
			});

			// Request Error
			req.on("error", (error: Error) => {
				if (signal.aborted) return;
				logger.error('Request setup error:', error, { url: options.url });
				signal.removeEventListener("abort", onAbort);
				handlers.onError(error);
				reject(error);
			});

			// Send Body
			if (options.body) { req.write(options.body); }
			req.end();
			// logger.debug("Electron net request ended (sent).", { url: options.url });
		});
	}

	// --- Fetch API Request Implementation ---
	private async makeFetchRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		const { signal } = options.abortController;
		if (signal.aborted) { /* ... handle pre-aborted ... */ handlers.onError(new Error("Request aborted before starting (fetch)")); return; }

		try {
			const response = await fetch(options.url, {
				method: options.method,
				headers: options.headers,
				body: options.body,
				signal: signal,
				mode: 'cors',
			});

			logger.debug(`Fetch response received: ${response.status} ${response.statusText}`, { url: options.url });

			if (!response.ok) { /* ... handle non-ok status ... */
				let errorBody = ''; try { errorBody = await response.text(); } catch (bodyError) { logger.warn("Could not read error body:", bodyError); }
				const statusError = new Error(`Request failed: ${response.status} ${response.statusText}${errorBody ? `\nBody: ${errorBody.substring(0, 500)}` : ''}`);
				handlers.onError(statusError); return;
			}

			const reader = response.body?.getReader();
			if (!reader) { throw new Error("Unable to get ReadableStream reader from fetch response"); }
			const decoder = new TextDecoder();

			try {
				while (!signal.aborted) {
					if (signal.aborted) { throw new Error("Request aborted during streaming"); } // Throw to be caught below

					const { done, value } = await reader.read();
					if (done) { logger.debug("Fetch response stream ended.", { url: options.url }); break; }

					try { if (value) { handlers.onData(decoder.decode(value, { stream: true })); } }
					catch (dataError) {
						logger.error("Error in onData handler (fetch):", dataError);
						try { await reader.cancel("Error in onData handler"); } catch (cancelError) {/* ignore */}
						handlers.onError(dataError instanceof Error ? dataError : new Error(String(dataError)));
						return; // Exit loop and function on handler error
					}
				}
				// Flush decoder buffer
				const finalChunk = decoder.decode(); if (finalChunk) { handlers.onData(finalChunk); }
				// Call onEnd only if stream finished without abort/error
				if (!signal.aborted) { try { handlers.onEnd(); } catch (endError) { /* ... */ } }

			} finally {
				// Ensure the reader lock is released if the stream hasn't naturally ended
				// This might happen on errors or premature exit
				if (reader) {
					try {
						// Check if the stream is locked before releasing, though releaseLock() handles it
						reader.releaseLock();
					} catch (releaseError) {
						logger.warn("Error releasing fetch reader lock:", releaseError);
					}
				}
			}

		} catch (error) {
			if (error instanceof Error && (error.name === 'AbortError' || error.message.includes("aborted"))) {
				logger.warn('Fetch request aborted.', { url: options.url });
				handlers.onError(new Error("Request aborted"));
			} else {
				logger.error('Fetch request failed:', error, { url: options.url });
				handlers.onError(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}
}

// --- END OF FILE request-handler.ts ---
