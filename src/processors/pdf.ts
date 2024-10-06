import { logger } from "../logger.js";
import * as pdfjs from "pdfjs-dist";
import { TextItem } from "pdfjs-dist/types/src/display/api.js";

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
	const textContent = await page.getTextContent();
	return textContent.items
		.filter((item) => "str" in item)
		.map((item: TextItem) => item.str)
		.join(" ");
}
