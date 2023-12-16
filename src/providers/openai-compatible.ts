import { requestUrl } from "obsidian";
import { LocalGPTAction, AIProvider } from "../interfaces";
import { streamer } from "../streamer";

export interface OpenAICompatibleMessage {
	role: "system" | "user";
	content: string;
}
export interface OpenAICompatibleRequestBody {
	messages: OpenAICompatibleMessage[];
	stream: boolean;
}

export class OpenAICompatibleAIProvider implements AIProvider {
	constructor({ url, abortController, onUpdate }: any) {
		this.url = url;
		this.abortController = abortController;
		this.onUpdate = onUpdate;
	}
	url: string;
	onUpdate: (text: string) => void;
	abortController: AbortController;

	process(text: string, action: LocalGPTAction) {
		const requestBody: OpenAICompatibleRequestBody = {
			stream: true,
			messages: [
				(action.system && {
					role: "system",
					content: action.system,
				}) as OpenAICompatibleMessage,
				{
					role: "user",
					content: [action.prompt, text].filter(Boolean).join("\n\n"),
				},
			].filter(Boolean) as OpenAICompatibleMessage[],
		};

		const { abortController } = this;

		return fetch(`${this.url.replace(/\/+$/i, "")}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
			signal: abortController.signal,
		}).then((response) => {
			let combined = "";

			return streamer({
				response,
				abortController,
				onNext: (data: string) => {
					const lines = data
						.split("\n")
						.filter((line: string) => line.trim() !== "");
					for (const line of lines) {
						const message = line.replace(/^data: /, "");
						try {
							const parsed = JSON.parse(message);
							combined += parsed.choices[0]?.delta?.content || "";
						} catch (error) {
							console.error(
								"Could not JSON parse stream message",
								message,
								error,
							);
						}
					}
					this.onUpdate(combined);
				},
				onDone: () => {
					return combined;
				},
			});
		});
	}
}
