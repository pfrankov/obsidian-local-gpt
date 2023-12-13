import { requestUrl } from "obsidian";
import { LocalGPTAction, AIProvider } from "../interfaces";

export interface OpenAICompatibleMessage {
	role: "system" | "user";
	content: string;
}
export interface OpenAICompatibleRequestBody {
	messages: OpenAICompatibleMessage[];
}

export class OpenAICompatibleAIProvider implements AIProvider {
	constructor({ url }: any) {
		this.url = url;
	}
	url: string;

	process(text: string, action: LocalGPTAction) {
		const requestBody: OpenAICompatibleRequestBody = {
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

		return requestUrl({
			method: "POST",
			url: `${this.url.replace(/\/+$/i, "")}/v1/chat/completions`,
			body: JSON.stringify(requestBody),
		}).then(({ json }) => {
			return json.choices[0].message.content;
		});
	}
}
