interface StreamerOptions {
	response: Response;
	abortController: AbortController;
	onDone(): string;
	onNext(text: string): void;
}

export async function streamer({
	response,
	abortController,
	onDone,
	onNext,
}: StreamerOptions): Promise<string> {
	const reader = response.body?.getReader();
	const decoder = new TextDecoder();

	if (!reader) {
		return "";
	}

	try {
		while (true) {
			if (abortController.signal.aborted) {
				break;
			}

			const { done, value } = await reader.read();
			const decodedValue = decoder.decode(value);
			if (done) {
				break;
			}

			onNext && onNext(decodedValue);
		}
	} catch (e) {}

	return onDone && onDone();
}
