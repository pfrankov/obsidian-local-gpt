export interface PWAConfig {
	name: string;
	shortName: string;
	description: string;
	themeColor: string;
	backgroundColor: string;
	display: "fullscreen" | "standalone" | "minimal-ui" | "browser";
	orientation: "any" | "natural" | "landscape" | "portrait";
	startUrl: string;
	scope: string;
	icons: PWAIcon[];
}

export interface PWAIcon {
	src: string;
	sizes: string;
	type: string;
	purpose?: "any" | "maskable" | "monochrome";
}

export interface PWAManifest {
	name: string;
	short_name: string;
	description: string;
	theme_color: string;
	background_color: string;
	display: string;
	orientation: string;
	start_url: string;
	scope: string;
	icons: PWAIcon[];
}
