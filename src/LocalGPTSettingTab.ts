import { App, Notice, PluginSettingTab, requestUrl, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction, Providers } from "./interfaces";

const SEPARATOR = "✂️";

export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;
	editEnabled: boolean = false;
	editExistingAction?: LocalGPTAction;
	modelsOptions: any = {};
	changingOrder = false;
	useFallback = false;
	selectedProvider = "";

	constructor(app: App, plugin: LocalGPT) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		this.selectedProvider =
			this.selectedProvider || this.plugin.settings.defaultProvider;
		this.useFallback =
			this.useFallback || Boolean(this.plugin.settings.fallbackProvider);

		const mainProviders = {
			[Providers.OLLAMA]: "Ollama",
			[Providers.OPENAI_COMPATIBLE]: "OpenAI compatible server",
		};

		const fallbackProviders = {
			...mainProviders,
		};

		if (this.plugin.settings.defaultProvider === Providers.OLLAMA) {
			// @ts-ignore
			delete fallbackProviders[Providers.OLLAMA];
			// @ts-ignore
			fallbackProviders[Providers.OLLAMA_FALLBACK] = "2️⃣ Ollama";
		}
		if (
			this.plugin.settings.defaultProvider === Providers.OPENAI_COMPATIBLE
		) {
			// @ts-ignore
			delete fallbackProviders[Providers.OPENAI_COMPATIBLE];
			// @ts-ignore
			fallbackProviders[Providers.OPENAI_COMPATIBLE_FALLBACK] =
				"2️⃣ OpenAI compatible servers";
		}

		new Setting(containerEl)
			.setHeading()
			.setName("Selected AI provider")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(mainProviders)
					.setValue(String(this.plugin.settings.defaultProvider))
					.onChange(async (value) => {
						this.plugin.settings.defaultProvider = value;
						this.selectedProvider = value;

						if (this.useFallback) {
							// @ts-ignore
							this.plugin.settings.fallbackProvider = Object.keys(
								mainProviders,
							).find((key) => key !== value);
						}

						await this.plugin.saveSettings();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Use fallback")
			.addToggle((component) => {
				component.setValue(this.useFallback).onChange(async (value) => {
					this.useFallback = value;
					if (value) {
						const firstAvailableProvider =
							Object.keys(fallbackProviders)[0];
						this.plugin.settings.fallbackProvider =
							firstAvailableProvider;
						this.selectedProvider = firstAvailableProvider;
					} else {
						this.plugin.settings.fallbackProvider = "";
						this.selectedProvider =
							this.plugin.settings.defaultProvider;
					}
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.useFallback) {
			new Setting(containerEl)
				.setName("Fallback AI provider")
				.setDesc(
					"If the Default provider is not accessible the plugin will try to reach the fallback one.",
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(fallbackProviders)
						.setValue(String(this.plugin.settings.fallbackProvider))
						.onChange(async (value) => {
							this.plugin.settings.fallbackProvider = value;
							this.selectedProvider = value;
							await this.plugin.saveSettings();
							this.display();
						}),
				);
		}

		containerEl.createEl("div", { cls: "local-gpt-settings-separator" });

		containerEl.createEl("h3", { text: "Providers configuration" });
		const selectedProviderConfig =
			this.plugin.settings.providers[this.selectedProvider];

		const aiProvider = new Setting(containerEl)
			.setHeading()
			.setName("Configure AI provider")
			.setDesc("")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						...mainProviders,
						...(this.useFallback && {
							[Providers.OLLAMA_FALLBACK]: "2️⃣ Ollama",
							[Providers.OPENAI_COMPATIBLE_FALLBACK]:
								"2️⃣ OpenAI compatible servers",
						}),
					})
					.setValue(String(this.selectedProvider))
					.onChange(async (value) => {
						this.selectedProvider = value;
						this.display();
					}),
			);

		aiProvider.descEl.innerHTML = `
			If you would like to use other providers, please let me know <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/1">in the discussions</a>
		`;

		if (selectedProviderConfig.type === Providers.OLLAMA) {
			new Setting(containerEl)
				.setName("Ollama URL")
				.setDesc("Default is http://localhost:11434")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(selectedProviderConfig.ollamaUrl)
						.onChange(async (value) => {
							selectedProviderConfig.ollamaUrl = value;
							await this.plugin.saveSettings();
						}),
				);

			const ollamaDefaultModel = new Setting(containerEl)
				.setName("Default model")
				.setDesc("Name of the default Ollama model to use in prompts");
			if (selectedProviderConfig.ollamaUrl) {
				requestUrl(`${selectedProviderConfig.ollamaUrl}/api/tags`)
					.then(({ json }) => {
						if (!json.models || json.models.length === 0) {
							return Promise.reject();
						}
						this.modelsOptions = json.models.reduce(
							(acc: any, el: any) => {
								const name = el.name.replace(":latest", "");
								acc[name] = name;
								return acc;
							},
							{},
						);

						ollamaDefaultModel
							.addDropdown((dropdown) =>
								dropdown
									.addOptions(this.modelsOptions)
									.setValue(
										String(
											selectedProviderConfig.defaultModel,
										),
									)
									.onChange(async (value) => {
										selectedProviderConfig.defaultModel =
											value;
										await this.plugin.saveSettings();
									}),
							)
							.addButton((button) =>
								button
									.setIcon("refresh-cw")
									.onClick(async () => {
										this.display();
									}),
							);
					})
					.catch(() => {
						ollamaDefaultModel.descEl.innerHTML = `Get the models from <a href="https://ollama.ai/library">Ollama library</a> or check that Ollama URL is correct.`;
						ollamaDefaultModel.addButton((button) =>
							button.setIcon("refresh-cw").onClick(async () => {
								this.display();
							}),
						);
					});
			}
		}
		if (selectedProviderConfig.type === Providers.OPENAI_COMPATIBLE) {
			const openAICompatible = new Setting(containerEl)
				.setName("OpenAI compatible server URL")
				.setDesc("")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:8080")
						.setValue(selectedProviderConfig.url)
						.onChange(async (value) => {
							selectedProviderConfig.url = value;
							await this.plugin.saveSettings();
						}),
				);
			openAICompatible.descEl.innerHTML = `
				There are several options to run local OpenAI-like server:
				<ul>
					<li><a href="https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md">llama.cpp</a></li>
					<li><a href="https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server">llama-cpp-python</a></li>
					<li><a href="https://localai.io/model-compatibility/llama-cpp/#setup">LocalAI</a></li>
					<li>Obabooga <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/8">Text generation web UI</a></li>
					<li><a href="https://lmstudio.ai/">LM Studio</a></li>
				</ul>
				After all installation and configuration make sure that you're using compatible model.<br/>
				For llama.cpp it is necessary to use models in ChatML format (e.g. <a href="https://huggingface.co/TheBloke/Orca-2-7B-GGUF/blob/main/orca-2-7b.Q4_K_M.gguf">Orca 2</a>)
			`;

			const apiKey = new Setting(containerEl)
				.setName("API key")
				.setDesc("")
				.addText((text) =>
					text
						.setPlaceholder("")
						// @ts-ignore
						.setValue(selectedProviderConfig.apiKey)
						.onChange(async (value) => {
							selectedProviderConfig.apiKey = value;
							await this.plugin.saveSettings();
						}),
				);

			apiKey.descEl.innerHTML = `
				Optional. Check <a href="https://github.com/pfrankov/obsidian-local-gpt#using-with-openai">the docs</a> if you'd like to use OpenAI servers.
			`;

			const openaiDefaultModel = new Setting(containerEl)
				.setName("Default model")
				.setDesc(
					"Optional. Name of the default model to use in prompts",
				);

			if (selectedProviderConfig.url) {
				requestUrl({
					url: `${selectedProviderConfig.url.replace(
						/\/+$/i,
						"",
					)}/v1/models`,
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${selectedProviderConfig.apiKey}`,
					},
				})
					.then(({ json }) => {
						if (!json.data || json.data.length === 0) {
							return Promise.reject();
						}
						const modelsOptions = json.data.reduce(
							(acc: any, el: any) => {
								const name = el.id;
								acc[name] = name;
								return acc;
							},
							{},
						);

						openaiDefaultModel
							.addDropdown((dropdown) =>
								dropdown
									.addOption("", "Not specified")
									.addOptions(modelsOptions)
									.setValue(
										String(
											selectedProviderConfig.defaultModel,
										),
									)
									.onChange(async (value) => {
										selectedProviderConfig.defaultModel =
											value;
										await this.plugin.saveSettings();
									}),
							)
							.addButton((button) =>
								button
									.setIcon("refresh-cw")
									.onClick(async () => {
										this.display();
									}),
							);
					})
					.catch(() => {
						openaiDefaultModel.addButton((button) =>
							button.setIcon("refresh-cw").onClick(async () => {
								this.display();
							}),
						);
					});
			}
		}

		const editingAction: LocalGPTAction = this.editExistingAction || {
			name: "",
			prompt: "",
			model: "",
			temperature: undefined,
			system: "",
			replace: false,
		};

		const sharingActionsMapping = {
			name: "Name: ",
			system: "System: ",
			prompt: "Prompt: ",
			replace: "Replace: ",
			model: "Model: ",
		};

		containerEl.createEl("div", { cls: "local-gpt-settings-separator" });

		containerEl.createEl("h3", { text: "Actions" });

		if (!this.editEnabled) {
			const quickAdd = new Setting(containerEl)
				.setName("Quick add")
				.setDesc("")
				.addText((text) => {
					text.inputEl.style.minWidth = "100%";
					text.setPlaceholder("Paste action");
					text.onChange(async (value) => {
						const quickAddAction: LocalGPTAction = value
							.split(SEPARATOR)
							.map((part) => part.trim())
							.reduce((acc, part) => {
								const foundMatchKey = Object.keys(
									sharingActionsMapping,
								).find((key) => {
									return part.startsWith(
										sharingActionsMapping[
											key as keyof typeof sharingActionsMapping
										],
									);
								});

								if (foundMatchKey) {
									// @ts-ignore
									acc[foundMatchKey] = part.substring(
										sharingActionsMapping[
											foundMatchKey as keyof typeof sharingActionsMapping
										].length,
										part.length,
									);
								}

								return acc;
							}, {} as LocalGPTAction);

						if (
							quickAddAction.name &&
							(quickAddAction.system || quickAddAction.prompt)
						) {
							await this.addNewAction(quickAddAction);
							text.setValue("");
							this.display();
						}
					});
				});

			quickAdd.descEl.innerHTML = `You can share the best sets prompts or get one <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/2">from the community</a>.<br/><strong>Important:</strong> if you already have an action with the same name it will be overwritten.`;

			new Setting(containerEl)
				.setName("Add new manually")
				.addButton((button) =>
					button.setIcon("plus").onClick(async () => {
						this.editEnabled = true;
						this.editExistingAction = undefined;
						this.display();
					}),
				);
		} else {
			// new Setting(containerEl)
			// 	.setName("AI provider")
			// 	.setDesc("Optional")
			// 	.addDropdown((dropdown) => {
			// 		dropdown
			// 			.addOption("", "Default AI provider")
			// 			.addOptions(mainProviders)
			// 			.onChange(async (value) => {
			// 				editingAction.model = value;
			// 			});
			// 		editingAction?.model &&
			// 			dropdown.setValue(editingAction.model);
			// 	});
			if (
				this.plugin.settings.providers[
					this.plugin.settings.defaultProvider
				].type === Providers.OLLAMA
			) {
				new Setting(containerEl)
					.setName("Model")
					.setDesc("Optional")
					.addDropdown((dropdown) => {
						dropdown
							.addOption("", "Default model")
							.addOptions(this.modelsOptions)
							.onChange(async (value) => {
								editingAction.model = value;
							});
						editingAction?.model &&
							dropdown.setValue(editingAction.model);
					});
			}
			new Setting(containerEl).setName("Action name").addText((text) => {
				editingAction?.name && text.setValue(editingAction.name);
				text.inputEl.style.minWidth = "100%";
				text.setPlaceholder("Summarize selection");
				text.onChange(async (value) => {
					editingAction.name = value;
				});
			});

			new Setting(containerEl)
				.setName("System prompt")
				.setDesc("Optional")
				.addTextArea((text) => {
					editingAction?.system &&
						text.setValue(editingAction.system);
					text.inputEl.style.minWidth = "100%";
					text.inputEl.style.minHeight = "6em";
					text.inputEl.style.resize = "vertical";
					text.setPlaceholder("You are a helpful assistant.");
					text.onChange(async (value) => {
						editingAction.system = value;
					});
				});

			new Setting(containerEl).setName("Prompt").addTextArea((text) => {
				editingAction?.prompt && text.setValue(editingAction.prompt);
				text.inputEl.style.minWidth = "100%";
				text.inputEl.style.minHeight = "6em";
				text.inputEl.style.resize = "vertical";
				text.setPlaceholder("");
				text.onChange(async (value) => {
					editingAction.prompt = value;
				});
			});

			new Setting(containerEl)
				.setName("Replace selected text")
				.setDesc(
					"If checked, the highlighted text will be replaced with a response from the model.",
				)
				.addToggle((component) => {
					editingAction?.replace &&
						component.setValue(editingAction.replace);
					component.onChange(async (value) => {
						editingAction.replace = value;
					});
				});

			const actionButtonsRow = new Setting(containerEl).setName("");

			if (this.editExistingAction) {
				actionButtonsRow.addButton((button) => {
					button.buttonEl.style.marginRight = "2em";
					button.setButtonText("Remove").onClick(async () => {
						if (!button.buttonEl.hasClass("mod-warning")) {
							button.setClass("mod-warning");
							return;
						}

						this.plugin.settings.actions =
							this.plugin.settings.actions.filter(
								(innerAction) => innerAction !== editingAction,
							);
						await this.plugin.saveSettings();
						this.editExistingAction = undefined;
						this.editEnabled = false;
						this.display();
					});
				});
			}

			actionButtonsRow
				.addButton((button) => {
					button.setButtonText("Close").onClick(async () => {
						this.editEnabled = false;
						this.editExistingAction = undefined;
						this.display();
					});
				})
				.addButton((button) =>
					button
						.setCta()
						.setButtonText("Save")
						.onClick(async () => {
							if (!editingAction.name) {
								new Notice(
									"Please enter a name for the action.",
								);
								return;
							}
							if (
								!editingAction.prompt &&
								!editingAction.system
							) {
								new Notice(
									"Please enter a prompt for the action.",
								);
								return;
							}

							if (!this.editExistingAction) {
								if (
									this.plugin.settings.actions.find(
										(action) =>
											action.name === editingAction.name,
									)
								) {
									new Notice(
										`An action with the name "${editingAction.name}" already exists.`,
									);
									return;
								}

								await this.addNewAction(editingAction);
							} else {
								if (
									this.plugin.settings.actions.filter(
										(action) =>
											action.name === editingAction.name,
									).length > 1
								) {
									new Notice(
										`An action with the name "${editingAction.name}" already exists.`,
									);
									return;
								}

								const index =
									this.plugin.settings.actions.findIndex(
										(innerAction) =>
											innerAction === editingAction,
									);

								this.plugin.settings.actions[index] =
									editingAction;
							}

							await this.plugin.saveSettings();

							this.editEnabled = false;
							this.editExistingAction = undefined;
							this.display();
						}),
				);
		}

		containerEl.createEl("h4", { text: "Actions list" });

		let defaultModel = "";
		if (selectedProviderConfig.type === Providers.OLLAMA) {
			defaultModel = selectedProviderConfig.defaultModel;
		}

		this.plugin.settings.actions.forEach((action, actionIndex) => {
			const sharingString = [
				action.name && `${sharingActionsMapping.name}${action.name}`,
				action.system &&
					`${sharingActionsMapping.system}${action.system}`,
				action.prompt &&
					`${sharingActionsMapping.prompt}${action.prompt}`,
				action.replace &&
					`${sharingActionsMapping.replace}${action.replace}`,
				this.plugin.settings.defaultProvider === Providers.OLLAMA &&
					(action.model || defaultModel) &&
					`${sharingActionsMapping.model}${
						action.model || defaultModel
					}`,
			]
				.filter(Boolean)
				.join(` ${SEPARATOR}\n`);

			if (!this.changingOrder) {
				const actionRow = new Setting(containerEl)
					.setName(action.name)
					.setDesc("")
					.addButton((button) =>
						button.setIcon("copy").onClick(async () => {
							navigator.clipboard.writeText(sharingString);
							new Notice("Copied");
						}),
					)
					.addButton((button) =>
						button.setButtonText("Edit").onClick(async () => {
							this.editEnabled = true;
							this.editExistingAction =
								this.plugin.settings.actions.find(
									(innerAction) =>
										innerAction.name == action.name,
								);
							this.display();
						}),
					);
				actionRow.descEl.innerHTML = [
					action.system &&
						`<b>${sharingActionsMapping.system}</b>${action.system}`,
					action.prompt &&
						`<b>${sharingActionsMapping.prompt}</b>${action.prompt}`,
					this.plugin.settings.defaultProvider === Providers.OLLAMA &&
						action.model &&
						`<b>${sharingActionsMapping.model}</b>${action.model}`,
				]
					.filter(Boolean)
					.join("<br/>\n");
			} else {
				const actionRow = new Setting(containerEl)
					.setName(action.name)
					.setDesc("");

				if (actionIndex > 0) {
					actionRow.addButton((button) =>
						button.setIcon("arrow-up").onClick(async () => {
							const prev =
								this.plugin.settings.actions[actionIndex - 1];
							this.plugin.settings.actions[actionIndex - 1] =
								action;
							this.plugin.settings.actions[actionIndex] = prev;
							await this.plugin.saveSettings();
							this.display();
						}),
					);
				}
				if (actionIndex < this.plugin.settings.actions.length - 1) {
					actionRow.addButton((button) =>
						button.setIcon("arrow-down").onClick(async () => {
							const next =
								this.plugin.settings.actions[actionIndex + 1];
							this.plugin.settings.actions[actionIndex + 1] =
								action;
							this.plugin.settings.actions[actionIndex] = next;
							await this.plugin.saveSettings();
							this.display();
						}),
					);
				}
			}
		});

		if (this.plugin.settings.actions.length) {
			new Setting(containerEl).setName("").addButton((button) => {
				this.changingOrder && button.setCta();
				button
					.setButtonText(this.changingOrder ? "Done" : "Change order")
					.onClick(async () => {
						this.changingOrder = !this.changingOrder;
						this.display();
					});
			});
		}

		containerEl.createEl("h4", { text: "Danger zone" });
		new Setting(containerEl)
			.setName("Reset actions")
			.setDesc(
				"🚨 Reset all actions to the default. This cannot be undone and will delete all your custom actions.",
			)
			.addButton((button) =>
				button
					.setClass("mod-warning")
					.setButtonText("Reset")
					.onClick(async () => {
						button.setDisabled(true);
						button.buttonEl.setAttribute("disabled", "true");
						button.buttonEl.classList.remove("mod-warning");
						this.plugin.settings.actions = DEFAULT_SETTINGS.actions;
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	async addNewAction(editingAction: LocalGPTAction) {
		const alreadyExistingActionIndex =
			this.plugin.settings.actions.findIndex(
				(action) => action.name === editingAction.name,
			);

		if (alreadyExistingActionIndex >= 0) {
			this.plugin.settings.actions[alreadyExistingActionIndex] =
				editingAction;
			new Notice(`Rewritten "${editingAction.name}" action`);
		} else {
			this.plugin.settings.actions = [
				editingAction,
				...this.plugin.settings.actions,
			];
			new Notice(`Added "${editingAction.name}" action`);
		}
		await this.plugin.saveSettings();
	}
}
