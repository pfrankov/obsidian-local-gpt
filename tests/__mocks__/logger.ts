import { vi } from "vitest";

export const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	table: vi.fn(),
	time: vi.fn(),
	timeEnd: vi.fn(),
};
