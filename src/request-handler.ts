// @ts-ignore
import { remote } from "electron";
import { logger } from "./logger";

type RequestOptions = {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
	abortController: AbortController;
};

type ResponseHandler = {
	onData: (chunk: string) => void;
	onError: (error: Error) => void;
	onEnd: () => void;
};

export class RequestHandler {
	private static instance: RequestHandler;
	private useRemoteRequest: boolean = true;

	static getInstance(): RequestHandler {
		if (!RequestHandler.instance) {
			RequestHandler.instance = new RequestHandler();
		}
		return RequestHandler.instance;
	}

	async makeRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		try {
			if (this.useRemoteRequest) {
				return await this.makeRemoteRequest(options, handlers);
			} else {
				return await this.makeFetchRequest(options, handlers);
			}
		} catch (error) {
			handlers.onError(error as Error);
		}
	}

	private async makeRemoteRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = remote.net.request({
				method: options.method,
				url: options.url,
			});
			logger.debug("Request url:", options.url);

			if (options.abortController.signal.aborted) {
				handlers.onError(new Error("Request aborted"));
				reject();
				return;
			}

			options.abortController.signal.addEventListener("abort", () => {
				logger.debug("Request aborted");
				request.abort();
				handlers.onError(new Error("Request aborted"));
				reject();
			});

			if (options.headers) {
				Object.entries(options.headers).forEach(([key, value]) => {
					request.setHeader(key, value);
				});
			}

			request.on("response", (response: any) => {
				logger.debug(
					"Response headers:",
					JSON.stringify(response.headers, null, 2),
				);
				logger.debug("Response status:", response.statusCode);

				response.on("data", (chunk: Buffer) => {
					if (options.abortController.signal.aborted) {
						handlers.onError(new Error("Request aborted"));
						reject();
						return;
					}
					handlers.onData(chunk.toString("utf8"));
				});
				response.on("end", () => {
					logger.debug("Response end");
					handlers.onEnd();
					resolve();
				});
			});

			request.on("error", (error: Error) => {
				handlers.onError(error);
				reject(error);
			});

			if (options.body) {
				request.write(options.body);
			}

			request.end();
		});
	}

	private async makeFetchRequest(
		options: RequestOptions,
		handlers: ResponseHandler,
	): Promise<void> {
		try {
			const response = await fetch(options.url, {
				method: options.method,
				headers: options.headers,
				body: options.body,
				signal: options.abortController.signal,
			});

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("Unable to read response body");
			}

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				handlers.onData(new TextDecoder().decode(value));
			}

			handlers.onEnd();
		} catch (error) {
			handlers.onError(error as Error);
		}
	}
}
