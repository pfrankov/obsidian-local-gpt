import { App, Modal, Notice, Setting } from "obsidian";
import { PWAConfig } from "./pwaInterfaces";
import {
	generateManifest,
	generateServiceWorker,
	generateIndexHTML,
	generateCSS,
	generateJS,
	getDefaultPWAConfig,
} from "./pwaGenerator";

export class PWACreatorModal extends Modal {
	private config: PWAConfig;
	private onSubmit: (config: PWAConfig) => void;

	constructor(app: App, onSubmit: (config: PWAConfig) => void) {
		super(app);
		this.config = getDefaultPWAConfig();
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Create Progressive Web App" });
		contentEl.createEl("p", {
			text: "Configure your PWA settings. All files will be generated and saved to your vault.",
			cls: "setting-item-description",
		});

		// App Name
		new Setting(contentEl)
			.setName("App Name")
			.setDesc("Full name of your application")
			.addText((text) =>
				text
					.setPlaceholder("My Progressive Web App")
					.setValue(this.config.name)
					.onChange(async (value) => {
						this.config.name = value;
					}),
			);

		// Short Name
		new Setting(contentEl)
			.setName("Short Name")
			.setDesc("Short name for home screen (12 chars max recommended)")
			.addText((text) =>
				text
					.setPlaceholder("My PWA")
					.setValue(this.config.shortName)
					.onChange(async (value) => {
						this.config.shortName = value;
					}),
			);

		// Description
		new Setting(contentEl)
			.setName("Description")
			.setDesc("Brief description of your app")
			.addTextArea((text) => {
				text.setPlaceholder(
					"A Progressive Web App created with Local GPT PWA Creator",
				)
					.setValue(this.config.description)
					.onChange(async (value) => {
						this.config.description = value;
					});
				text.inputEl.rows = 3;
				text.inputEl.cols = 50;
			});

		// Theme Color
		new Setting(contentEl)
			.setName("Theme Color")
			.setDesc("Primary theme color (hex format)")
			.addText((text) =>
				text
					.setPlaceholder("#2196f3")
					.setValue(this.config.themeColor)
					.onChange(async (value) => {
						this.config.themeColor = value;
					}),
			);

		// Background Color
		new Setting(contentEl)
			.setName("Background Color")
			.setDesc("Background color (hex format)")
			.addText((text) =>
				text
					.setPlaceholder("#ffffff")
					.setValue(this.config.backgroundColor)
					.onChange(async (value) => {
						this.config.backgroundColor = value;
					}),
			);

		// Display Mode
		new Setting(contentEl)
			.setName("Display Mode")
			.setDesc("How the app should be displayed")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("standalone", "Standalone (Recommended)")
					.addOption("fullscreen", "Fullscreen")
					.addOption("minimal-ui", "Minimal UI")
					.addOption("browser", "Browser")
					.setValue(this.config.display)
					.onChange(async (value) => {
						this.config.display = value as PWAConfig["display"];
					}),
			);

		// Orientation
		new Setting(contentEl)
			.setName("Orientation")
			.setDesc("Preferred screen orientation")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("any", "Any")
					.addOption("natural", "Natural")
					.addOption("landscape", "Landscape")
					.addOption("portrait", "Portrait")
					.setValue(this.config.orientation)
					.onChange(async (value) => {
						this.config.orientation =
							value as PWAConfig["orientation"];
					}),
			);

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "pwa-creator-buttons",
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.marginTop = "20px";

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const createButton = buttonContainer.createEl("button", {
			text: "Create PWA",
			cls: "mod-cta",
		});
		createButton.addEventListener("click", () => {
			this.handleCreate();
		});
	}

	private async handleCreate() {
		try {
			// Validate config
			if (!this.config.name || !this.config.shortName) {
				new Notice("Please provide both App Name and Short Name");
				return;
			}

			// Call the submit handler
			this.onSubmit(this.config);

			// Generate files
			await this.generatePWAFiles();

			new Notice("PWA files generated successfully!");
			this.close();
		} catch (error) {
			console.error("Error creating PWA:", error);
			new Notice("Error creating PWA. Check console for details.");
		}
	}

	private async generatePWAFiles() {
		const folderName = `PWA-${this.config.shortName.replace(/\s+/g, "-")}`;
		const folderPath = `${folderName}`;

		// Create folder if it doesn't exist
		try {
			await this.app.vault.createFolder(folderPath);
		} catch (error) {
			// Folder might already exist
			console.log("Folder already exists or error:", error);
		}

		// Generate and save manifest.json
		const manifestContent = generateManifest(this.config);
		await this.app.vault.create(
			`${folderPath}/manifest.json`,
			manifestContent,
		);

		// Generate and save service-worker.js
		const swContent = generateServiceWorker();
		await this.app.vault.create(
			`${folderPath}/service-worker.js`,
			swContent,
		);

		// Generate and save index.html
		const htmlContent = generateIndexHTML(this.config);
		await this.app.vault.create(`${folderPath}/index.html`, htmlContent);

		// Generate and save styles.css
		const cssContent = generateCSS();
		await this.app.vault.create(`${folderPath}/styles.css`, cssContent);

		// Generate and save script.js
		const jsContent = generateJS();
		await this.app.vault.create(`${folderPath}/script.js`, jsContent);

		// Create README
		const readmeContent = `# ${this.config.name}

${this.config.description}

## Files Generated

- \`manifest.json\`: PWA manifest file
- \`service-worker.js\`: Service worker for offline functionality
- \`index.html\`: Main HTML file
- \`styles.css\`: Stylesheet
- \`script.js\`: Application JavaScript

## How to Use

1. Copy all files to your web server
2. Ensure your server serves files over HTTPS (required for PWAs)
3. Add icon files (icon-192x192.png and icon-512x512.png)
4. Access your app via browser
5. Install it as a PWA from the browser menu

## Icon Requirements

You need to provide the following icons:
- \`icon-192x192.png\`: 192x192 pixels
- \`icon-512x512.png\`: 512x512 pixels

You can generate icons using online tools like:
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/

## Testing

Test your PWA using:
- Chrome DevTools > Application > Manifest
- Lighthouse audit in Chrome DevTools

## Next Steps

1. Customize the HTML, CSS, and JavaScript files
2. Add your app's functionality
3. Test on different devices
4. Deploy to your web server
`;
		await this.app.vault.create(`${folderPath}/README.md`, readmeContent);

		new Notice(`PWA files created in folder: ${folderName}`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
