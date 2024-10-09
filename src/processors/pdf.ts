import { logger } from "../logger.js";
import * as pdfjs from "pdfjs-dist";

// @ts-ignore
import WorkerMessageHandler from "./pdf.worker.js";

let isWorkerInitialized = false;

function initializeWorker(): void {
	if (!isWorkerInitialized) {
		pdfjs.GlobalWorkerOptions.workerPort = new WorkerMessageHandler();
		isWorkerInitialized = true;
	}
}

export async function extractTextFromPDF(
	arrayBuffer: ArrayBuffer,
): Promise<string> {
	logger.time("Extracting text from PDF");

	try {
		initializeWorker();

		const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
		const numPages = pdf.numPages;

		const textContents = await Promise.all(
			Array.from({ length: numPages }, (_, i) => getPageText(pdf, i + 1)),
		);

		const fullText = textContents.join("\n\n");

		logger.table("Extracted text from PDF", {
			textLength: fullText.length,
		});
		logger.timeEnd("Extracting text from PDF");
		return fullText;
	} catch (error) {
		logger.error("Error extracting text from PDF", { error });
		throw new Error(`Failed to extract text from PDF: ${error.message}`);
	}
}

async function getPageText(
	pdf: pdfjs.PDFDocumentProxy,
	pageNum: number,
): Promise<string> {
	const page = await pdf.getPage(pageNum);
	const content = await page.getTextContent();
	let lastY;
	const textItems = [];
	for (const item of content.items) {
		if ("str" in item) {
			if (lastY === item.transform[5] || !lastY) {
				textItems.push(item.str);
			} else {
				textItems.push(`\n${item.str}`);
			}
			lastY = item.transform[5];
		}
	}
	return textItems.join("") + "\n\n";
}
