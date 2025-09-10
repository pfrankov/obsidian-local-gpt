
<script lang="ts">
  import { onMount, createEventDispatcher, tick } from 'svelte';
  import { I18n } from '../i18n';

  // Constants
  const MAX_DROPDOWN_RESULTS = 15;
  const FILE_MENTION_REGEX = /@([^@]+?\.[a-zA-Z0-9]+)(?=\s|$|@)/g;
  const MENTION_PREFIX = '@';
  const SPACE_AFTER_MENTION = ' ';
  const COMMAND_REGEX = /\/([^\/\s]+)(?=\s|$|\/)/g;
  const COMMAND_PREFIX = '/';
  const SPACE_AFTER_COMMAND = ' ';

  // Type definitions
  interface FileReference {
    path: string;
    basename: string;
    extension: string;
  }

  interface CommandReference {
    name: string;
    description: string;
  }

  interface ProviderReference {
    id: string;
    name: string;
    providerName: string;
    providerUrl?: string;
  }

  interface ModelReference {
    id: string;
    name: string;
  }

  interface CreativityReference {
    id: string; // "", "low", "medium", "high"
    name: string; // localized label from settings.creativity*
  }

  interface TextToken {
    type: 'text' | 'file' | 'command';
    content: string;
    start: number;
    end: number;
    filePath?: string;
    commandName?: string;
  }

  interface SubmitEvent {
    text: string;
    selectedFiles: string[];
  }

  // Exported props
  export let placeholder: string = 'Type here…';
  export let value: string = '';
  export let providerLabel: string = '';
  export let providerId: string | undefined = undefined;
  export let getFiles: (() => FileReference[]) | undefined = undefined;
  export let getProviders: (() => Promise<ProviderReference[]>) | undefined = undefined;
  export let onProviderChange: ((providerId: string) => Promise<void>) | undefined = undefined;
  export let getModels: ((providerId: string) => Promise<ModelReference[]>) | undefined = undefined;
  export let onModelChange: ((model: string) => Promise<void>) | undefined = undefined;
  export let onCreativityChange: ((creativityKey: string) => Promise<void> | void) | undefined = undefined;

  // Event dispatcher
  const dispatch = createEventDispatcher<{ 
    submit: SubmitEvent; 
    cancel: void 
  }>();
  
  // DOM element references
  let contentElement: HTMLDivElement | null = null;
  let dropdownElement: HTMLDivElement | null = null;
  let commandDropdownElement: HTMLDivElement | null = null;
  let providerDropdownElement: HTMLDivElement | null = null;
  let modelDropdownElement: HTMLDivElement | null = null;
  let creativityDropdownElement: HTMLDivElement | null = null;
  
  // Dropdown state
  let isDropdownVisible = false;
  let isCommandDropdownVisible = false;
  let isProviderDropdownVisible = false;
  let isModelDropdownVisible = false;
  let isCreativityDropdownVisible = false;
  let filteredFiles: FileReference[] = [];
  let filteredCommands: CommandReference[] = [];
  let filteredProviders: ProviderReference[] = [];
  let filteredModels: ModelReference[] = [];
  let filteredCreativities: CreativityReference[] = [];
  let allProviders: ProviderReference[] = [];
  let allModels: ModelReference[] = [];
  let allCreativities: CreativityReference[] = [];
  let selectedDropdownIndex = -1;
  let selectedCommandIndex = -1;
  let selectedProviderIndex = -1;
  let selectedModelIndex = -1;
  let selectedCreativityIndex = -1;
  let badgeHighlight = false;
  
  // File and content state
  let selectedFiles: string[] = [];
  let textContent = '';
  let cursorPosition = 0;
  let mentionStartIndex = -1;
  let commandStartIndex = -1;
  
  // Text parsing state
  let textTokens: TextToken[] = [];

  let providerName = providerLabel.split(' · ')[0] || '';
  let modelName = (providerLabel.split(' · ')[1] || '').trim();
  let creativityBadge = (providerLabel.split(' · ')[2] || '').trim();

  function getCreativityOptions(): CreativityReference[] {
    return [
      { id: '', name: I18n.t('settings.creativityNone') },
      { id: 'low', name: I18n.t('settings.creativityLow') },
      { id: 'medium', name: I18n.t('settings.creativityMedium') },
      { id: 'high', name: I18n.t('settings.creativityHigh') },
    ];
  }

  function findMatchingFile(fileName: string, availableFiles: FileReference[]): FileReference | undefined {
    const normalizedFileName = fileName.toLowerCase();
    return availableFiles.find(file => {
      const fullFileName = `${file.basename}.${file.extension}`;
      return fullFileName.toLowerCase() === normalizedFileName;
    });
  }

  function extractMentionsFromText(text: string): { mentions: string[], newSelectedFiles: string[] } {
    if (!getFiles) {
      return { mentions: [], newSelectedFiles: [] };
    }

    const availableFiles = getFiles();
    const mentions: string[] = [];
    const newSelectedFiles: string[] = [];
    const mentionMatches = Array.from(text.matchAll(FILE_MENTION_REGEX));

    for (const match of mentionMatches) {
      const fileName = match[1].trim();
      const matchedFile = findMatchingFile(fileName, availableFiles);
      
      if (matchedFile && !selectedFiles.includes(matchedFile.path)) {
        newSelectedFiles.push(matchedFile.path);
      }
      
      mentions.push(match[0]);
    }

    return { mentions, newSelectedFiles };
  }

  function getAvailableCommands(): CommandReference[] {
    return [
      { name: 'provider', description: I18n.t('commands.actionPalette.changeProvider') },
      { name: 'model', description: I18n.t('commands.actionPalette.changeModel') },
      { name: 'creativity', description: I18n.t('commands.actionPalette.changeCreativity') },
    ];
  }

  async function fetchAvailableProviders(): Promise<ProviderReference[]> {
    if (!getProviders) return [];
    
    try {
      return await getProviders();
    } catch (error) {
      console.error('Error fetching providers:', error);
      return [];
    }
  }

  async function fetchAvailableModels(): Promise<ModelReference[]> {
    if (!getModels || !providerId) return [];

    try {
      return await getModels(providerId);
    } catch (error) {
      console.error('Error fetching models:', error);
      return [];
    }
  }

  function parseTextToTokens(text: string): TextToken[] {
    const tokens: TextToken[] = [];
    
    // Handle file mentions if getFiles is available
    if (getFiles) {
      const availableFiles = getFiles();
      const { newSelectedFiles } = extractMentionsFromText(text);
      
      // Update selected files with newly discovered ones
      if (newSelectedFiles.length > 0) {
        selectedFiles = [...selectedFiles, ...newSelectedFiles];
      }
    }
    
    // Get all matches (both file mentions and commands)
    const mentionMatches = getFiles ? Array.from(text.matchAll(FILE_MENTION_REGEX)) : [];
    const commandMatches = Array.from(text.matchAll(COMMAND_REGEX));
    
    // Combine all matches and sort by position
    const allMatches = [
      ...mentionMatches.map(match => ({ type: 'file', match })),
      ...commandMatches.map(match => ({ type: 'command', match }))
    ].sort((a, b) => a.match.index! - b.match.index!);
    
    let lastIndex = 0;
    
    for (const { type, match } of allMatches) {
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;
      
      // Add text before this match
      if (matchStart > lastIndex) {
        tokens.push({
          type: 'text',
          content: text.substring(lastIndex, matchStart),
          start: lastIndex,
          end: matchStart
        });
      }
      
      if (type === 'file' && getFiles) {
        const fileName = match[1].trim();
        const availableFiles = getFiles();
        const matchedFile = findMatchingFile(fileName, availableFiles);
        
        if (matchedFile) {
          // Valid file mention
          tokens.push({
            type: 'file',
            content: match[0],
            start: matchStart,
            end: matchEnd,
            filePath: matchedFile.path
          });
        } else {
          // Invalid file mention - treat as text
          tokens.push({
            type: 'text',
            content: match[0],
            start: matchStart,
            end: matchEnd
          });
        }
      } else if (type === 'command') {
        const commandName = match[1].trim();
        const availableCommands = getAvailableCommands();
        const matchedCommand = availableCommands.find(cmd => cmd.name === commandName);
        
        if (matchedCommand) {
          // Valid command
          tokens.push({
            type: 'command',
            content: match[0],
            start: matchStart,
            end: matchEnd,
            commandName: matchedCommand.name
          });
        } else {
          // Invalid command - treat as text
          tokens.push({
            type: 'text',
            content: match[0],
            start: matchStart,
            end: matchEnd
          });
        }
      }
      
      lastIndex = matchEnd;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      tokens.push({
        type: 'text',
        content: text.substring(lastIndex),
        start: lastIndex,
        end: text.length
      });
    }
    
    return tokens;
  }
  
  function getCurrentCursorPosition(): number {
    if (!contentElement) return 0;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    
    const range = selection.getRangeAt(0);
    let position = 0;
    const walker = document.createTreeWalker(
      contentElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let textNode;
    while (textNode = walker.nextNode()) {
      if (textNode === range.startContainer) {
        return position + range.startOffset;
      }
      position += textNode.textContent?.length || 0;
    }
    
    return position;
  }
  
  function setCursorPosition(position: number): void {
    if (!contentElement) return;
    
    const selection = window.getSelection();
    const range = document.createRange();
    
    let currentPosition = 0;
    const walker = document.createTreeWalker(
      contentElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let textNode;
    while (textNode = walker.nextNode()) {
      const nodeLength = textNode.textContent?.length || 0;
      if (currentPosition + nodeLength >= position) {
        const offset = position - currentPosition;
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset);
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      currentPosition += nodeLength;
    }
  }
  
  function escapeHtmlContent(text: string): string {
    const temporaryElement = document.createElement('div');
    temporaryElement.textContent = text;
    return temporaryElement.innerHTML;
  }

  function renderTokensAsHtml(): string {
    return textTokens.map(token => {
      if (token.type === 'file') {
        return `<span class="file-mention" data-path="${token.filePath}">${escapeHtmlContent(token.content)}</span>`;
      }
      if (token.type === 'command') {
        return `<span class="command-mention" data-command="${token.commandName}">${escapeHtmlContent(token.content)}</span>`;
      }
      return escapeHtmlContent(token.content);
    }).join('');
  }
  
  function updateContentDisplay(): void {
    if (!contentElement) return;
    
    const currentCursor = getCurrentCursorPosition();
    contentElement.innerHTML = renderTokensAsHtml();
    
    // Restore cursor position after update
    tick().then(() => {
      setCursorPosition(currentCursor);
    });
  }

  function setProviderBadgeLabel(pName: string, mName: string): void {
    providerName = pName;
    modelName = mName;
    const base = [providerName, modelName].filter(Boolean).join(' · ');
    providerLabel = creativityBadge ? `${base} · ${creativityBadge}` : base;
  }

  onMount(() => {
    // Auto-focus the content element
    queueMicrotask(() => {
      contentElement?.focus();
      if (value) {
        textContent = value;
        textTokens = parseTextToTokens(textContent);
        updateContentDisplay();
      }
    });
  });

  function handleDropdownNavigation(event: KeyboardEvent): boolean {
    if (isDropdownVisible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          selectedDropdownIndex = Math.min(selectedDropdownIndex + 1, filteredFiles.length - 1);
          scrollSelectedIntoView(dropdownElement, selectedDropdownIndex);
          return true;
          
        case 'ArrowUp':
          event.preventDefault();
          selectedDropdownIndex = Math.max(selectedDropdownIndex - 1, -1);
          scrollSelectedIntoView(dropdownElement, selectedDropdownIndex);
          return true;
          
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (selectedDropdownIndex >= 0 && filteredFiles[selectedDropdownIndex]) {
            insertFileAtCursor(filteredFiles[selectedDropdownIndex]);
          }
          return true;
          
        case 'Escape':
          event.preventDefault();
          hideDropdown();
          return true;
          
        default:
          return false;
        }
    }
    
    if (isCommandDropdownVisible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          selectedCommandIndex = Math.min(selectedCommandIndex + 1, filteredCommands.length - 1);
          scrollSelectedIntoView(commandDropdownElement, selectedCommandIndex);
          return true;
          
        case 'ArrowUp':
          event.preventDefault();
          selectedCommandIndex = Math.max(selectedCommandIndex - 1, -1);
          scrollSelectedIntoView(commandDropdownElement, selectedCommandIndex);
          return true;
          
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (selectedCommandIndex >= 0 && filteredCommands[selectedCommandIndex]) {
            insertCommandAtCursor(filteredCommands[selectedCommandIndex]);
          }
          return true;
          
        case 'Escape':
          event.preventDefault();
          hideCommandDropdown();
          return true;
          
        default:
          return false;
      }
    }
    
    return false;
  }

  function handleProviderDropdownNavigation(event: KeyboardEvent): boolean {
    if (isProviderDropdownVisible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          selectedProviderIndex = Math.min(selectedProviderIndex + 1, filteredProviders.length - 1);
          scrollSelectedIntoView(providerDropdownElement, selectedProviderIndex);
          return true;
          
        case 'ArrowUp':
          event.preventDefault();
          selectedProviderIndex = Math.max(selectedProviderIndex - 1, -1);
          scrollSelectedIntoView(providerDropdownElement, selectedProviderIndex);
          return true;
          
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (selectedProviderIndex >= 0 && filteredProviders[selectedProviderIndex]) {
            selectProvider(filteredProviders[selectedProviderIndex]);
          }
          return true;
          
        case 'Escape':
          event.preventDefault();
          hideProviderDropdown();
          return true;
          
        default:
          return false;
      }
    }
    
    return false;
  }

  function handleModelDropdownNavigation(event: KeyboardEvent): boolean {
    if (isModelDropdownVisible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          selectedModelIndex = Math.min(selectedModelIndex + 1, filteredModels.length - 1);
          scrollSelectedIntoView(modelDropdownElement, selectedModelIndex);
          return true;

        case 'ArrowUp':
          event.preventDefault();
          selectedModelIndex = Math.max(selectedModelIndex - 1, -1);
          scrollSelectedIntoView(modelDropdownElement, selectedModelIndex);
          return true;

        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (selectedModelIndex >= 0 && filteredModels[selectedModelIndex]) {
            selectModel(filteredModels[selectedModelIndex]);
          }
          return true;

        case 'Escape':
          event.preventDefault();
          hideModelDropdown();
          return true;

        default:
          return false;
      }
    }

    return false;
  }

  function handleCreativityDropdownNavigation(event: KeyboardEvent): boolean {
    if (isCreativityDropdownVisible) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          selectedCreativityIndex = Math.min(selectedCreativityIndex + 1, filteredCreativities.length - 1);
          scrollSelectedIntoView(creativityDropdownElement, selectedCreativityIndex);
          return true;

        case 'ArrowUp':
          event.preventDefault();
          selectedCreativityIndex = Math.max(selectedCreativityIndex - 1, -1);
          scrollSelectedIntoView(creativityDropdownElement, selectedCreativityIndex);
          return true;

        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (selectedCreativityIndex >= 0 && filteredCreativities[selectedCreativityIndex]) {
            selectCreativity(filteredCreativities[selectedCreativityIndex]);
          }
          return true;

        case 'Escape':
          event.preventDefault();
          hideCreativityDropdown();
          return true;

        default:
          return false;
      }
    }
    return false;
  }

  function handleGeneralNavigation(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        submitAction();
        break;
        
      case 'Escape':
        event.preventDefault();
        dispatch('cancel');
        break;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (handleDropdownNavigation(event)) {
      return;
    }

    if (handleProviderDropdownNavigation(event)) {
      return;
    }

    if (handleModelDropdownNavigation(event)) {
      return;
    }

    if (handleCreativityDropdownNavigation(event)) {
      return;
    }

    handleGeneralNavigation(event);
  }

  function handleInput(event: Event): void {
    const target = event.target as HTMLDivElement;
    const newTextContent = target.textContent || '';
    
    // Update content state
    textContent = newTextContent;
    cursorPosition = getCurrentCursorPosition();
    
    // Rebuild token structure
    textTokens = parseTextToTokens(textContent);
    
    // Check for file mentions and show dropdown if needed
    checkForMentionTrigger();
    
    // Check for command triggers and show dropdown if needed
    checkForCommandTrigger();
    
    // If provider dropdown is open, update its filter based on text after /provider
    if (isProviderDropdownVisible) {
      applyProviderFilter();
    }

    // If model dropdown is open, update its filter based on text after /model
    if (isModelDropdownVisible) {
      applyModelFilter();
    }
    
    // Update display if content has changed
    const newHtmlContent = renderTokensAsHtml();
    if (target.innerHTML !== newHtmlContent) {
      updateContentDisplay();
    }
  }

  function isCharacterWhitespace(character: string): boolean {
    return /\s/.test(character);
  }

  function isCompleteMention(mentionText: string): boolean {
    if (!getFiles) return false;
    
    return selectedFiles.some(filePath => {
      const file = getFiles()?.find(f => f.path === filePath);
      if (!file) return false;
      
      const fullFileName = `${file.basename}.${file.extension}`;
      return mentionText === `${MENTION_PREFIX}${fullFileName}`;
    });
  }

  function isCompleteCommand(commandText: string): boolean {
    const availableCommands = getAvailableCommands();
    return availableCommands.some(cmd => commandText === `${COMMAND_PREFIX}${cmd.name}`);
  }

  function filterAvailableCommands(query: string): CommandReference[] {
    const availableCommands = getAvailableCommands();
    const normalizedQuery = query.toLowerCase();
    
    return availableCommands
      .filter(command => {
        return command.name.toLowerCase().includes(normalizedQuery) ||
               command.description.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, MAX_DROPDOWN_RESULTS);
  }

  function filterAvailableFiles(query: string): FileReference[] {
    if (!getFiles) return [];
    
    const availableFiles = getFiles();
    const normalizedQuery = query.toLowerCase();
    
    return availableFiles
      .filter(file => {
        const fullFileName = `${file.basename}.${file.extension}`;
        const isQueryMatch = file.basename.toLowerCase().includes(normalizedQuery) || 
                             fullFileName.toLowerCase().includes(normalizedQuery);
        const isNotAlreadySelected = !selectedFiles.includes(file.path);
        
        return isQueryMatch && isNotAlreadySelected;
      })
      .slice(0, MAX_DROPDOWN_RESULTS);
  }

  function checkForMentionTrigger(): void {
    if (!getFiles) return;
    
    const beforeCursor = textContent.substring(0, cursorPosition);
    const mentionIndex = beforeCursor.lastIndexOf(MENTION_PREFIX);
    
    if (mentionIndex === -1) {
      hideDropdown();
      return;
    }
    
    // Ensure @ is at start or preceded by whitespace
    const characterBeforeMention = mentionIndex > 0 ? beforeCursor[mentionIndex - 1] : ' ';
    if (mentionIndex > 0 && !isCharacterWhitespace(characterBeforeMention)) {
      hideDropdown();
      return;
    }
    
    const textAfterMention = beforeCursor.substring(mentionIndex + 1);
    const possibleMention = MENTION_PREFIX + textAfterMention;
    
    // Don't show dropdown for complete mentions
    if (isCompleteMention(possibleMention)) {
      hideDropdown();
      return;
    }
    
    mentionStartIndex = mentionIndex;
    filteredFiles = filterAvailableFiles(textAfterMention);
    
    if (filteredFiles.length > 0) {
      isDropdownVisible = true;
      selectedDropdownIndex = 0;
    } else {
      hideDropdown();
    }
  }

  function hideDropdown(): void {
    isDropdownVisible = false;
    filteredFiles = [];
    selectedDropdownIndex = -1;
    mentionStartIndex = -1;
  }

  function hideCommandDropdown(): void {
    isCommandDropdownVisible = false;
    filteredCommands = [];
    selectedCommandIndex = -1;
    commandStartIndex = -1;
  }

  function hideProviderDropdown(): void {
    isProviderDropdownVisible = false;
    filteredProviders = [];
    selectedProviderIndex = -1;
    allProviders = [];
  }

  function hideModelDropdown(): void {
    isModelDropdownVisible = false;
    filteredModels = [];
    selectedModelIndex = -1;
    allModels = [];
  }

  function scrollSelectedIntoView(container: HTMLElement | null, index: number): void {
    if (!container || index < 0) return;
    const selectedItem = container.children[index] as HTMLElement;
    if (!selectedItem) return;
    const dropdownRect = container.getBoundingClientRect();
    const itemRect = selectedItem.getBoundingClientRect();
    const isItemVisible = itemRect.top >= dropdownRect.top && itemRect.bottom <= dropdownRect.bottom;
    if (!isItemVisible) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function insertFileAtCursor(file: FileReference): void {
    if (mentionStartIndex === -1) return;
    
    // Add to selected files if not already present
    if (!selectedFiles.includes(file.path)) {
      selectedFiles = [...selectedFiles, file.path];
    }
    
    // Build new text with file mention
    const fullFileName = `${file.basename}.${file.extension}`;
    const beforeMention = textContent.substring(0, mentionStartIndex);
    const afterCursor = textContent.substring(cursorPosition);
    const newText = beforeMention + MENTION_PREFIX + fullFileName + SPACE_AFTER_MENTION + afterCursor;
    
    // Update content state
    textContent = newText;
    textTokens = parseTextToTokens(textContent);
    
    hideDropdown();
    
    // Update display and cursor position
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        const newCursorPosition = beforeMention.length + fullFileName.length + 2; // +2 for @ and space
        setCursorPosition(newCursorPosition);
      });
    }
  }

  function checkForCommandTrigger(): void {
    const beforeCursor = textContent.substring(0, cursorPosition);
    const commandIndex = beforeCursor.lastIndexOf(COMMAND_PREFIX);
    
    if (commandIndex === -1) {
      // No command trigger near cursor: ensure all command-related dropdowns are closed
      hideCommandDropdown();
      hideProviderDropdown();
      hideModelDropdown();
      return;
    }
    
    // Ensure / is at start or preceded by whitespace
    const characterBeforeCommand = commandIndex > 0 ? beforeCursor[commandIndex - 1] : ' ';
    if (commandIndex > 0 && !isCharacterWhitespace(characterBeforeCommand)) {
      // '/' is part of a word, not a command: close dropdowns
      hideCommandDropdown();
      hideProviderDropdown();
      hideModelDropdown();
      return;
    }
    
    const textAfterCommand = beforeCursor.substring(commandIndex + 1);
    const firstTokenMatch = textAfterCommand.match(/([^\s\/]+)/);
    const typedName = firstTokenMatch ? firstTokenMatch[1] : '';
    const commandName = typedName.toLowerCase();
    
    commandStartIndex = commandIndex;
    
    // Special handling for '/provider' even if followed by a query (paste or typing)
    if (commandName === 'provider') {
      // Ensure provider dropdown is shown and filtered
      if (!isProviderDropdownVisible) {
        void showProviderDropdown();
      } else {
        applyProviderFilter();
      }
      // Hide other dropdowns while provider dropdown is active
      hideCommandDropdown();
      hideModelDropdown();
      return;
    }

    // Special handling for '/model'
    if (commandName === 'model') {
      if (!isModelDropdownVisible) {
        void showModelDropdown();
      } else {
        applyModelFilter();
      }
      hideCommandDropdown();
      hideProviderDropdown();
      return;
    }

    // Special handling for '/creativity'
    if (commandName === 'creativity') {
      if (!isCreativityDropdownVisible) {
        void showCreativityDropdown();
      } else {
        applyCreativityFilter();
      }
      hideCommandDropdown();
      hideProviderDropdown();
      hideModelDropdown();
      return;
    }
    
    // Otherwise, no exact command match: close provider/model dropdowns
    hideProviderDropdown();
    hideModelDropdown();
    hideCreativityDropdown();

    // Show command picker for partial commands (including bare '/')
    filteredCommands = filterAvailableCommands(textAfterCommand);
    if (filteredCommands.length > 0) {
      isCommandDropdownVisible = true;
      selectedCommandIndex = 0;
    } else {
      hideCommandDropdown();
    }
  }

  function insertCommandAtCursor(command: CommandReference): void {
    if (commandStartIndex === -1) return;
    
    const beforeCommand = textContent.substring(0, commandStartIndex);
    const afterCursor = textContent.substring(cursorPosition);
    
    if (command.name === 'provider') {
      // Insert the command and keep it visible while the provider dropdown is open
      const newText = beforeCommand + COMMAND_PREFIX + command.name + SPACE_AFTER_COMMAND + afterCursor;
      textContent = newText;
      textTokens = parseTextToTokens(textContent);
      hideCommandDropdown();
      
      if (contentElement) {
        updateContentDisplay();
        tick().then(() => {
          const newCursorPosition = beforeCommand.length + command.name.length + 2; // +2 for / and space
          setCursorPosition(newCursorPosition);
        });
      }
      
      showProviderDropdown();
      return;
    }

    if (command.name === 'model') {
      const newText = beforeCommand + COMMAND_PREFIX + command.name + SPACE_AFTER_COMMAND + afterCursor;
      textContent = newText;
      textTokens = parseTextToTokens(textContent);
      hideCommandDropdown();

      if (contentElement) {
        updateContentDisplay();
        tick().then(() => {
          const newCursorPosition = beforeCommand.length + command.name.length + 2;
          setCursorPosition(newCursorPosition);
        });
      }

      showModelDropdown();
      return;
    }

    if (command.name === 'creativity') {
      const newText = beforeCommand + COMMAND_PREFIX + command.name + SPACE_AFTER_COMMAND + afterCursor;
      textContent = newText;
      textTokens = parseTextToTokens(textContent);
      hideCommandDropdown();

      if (contentElement) {
        updateContentDisplay();
        tick().then(() => {
          const newCursorPosition = beforeCommand.length + command.name.length + 2; // / + space
          setCursorPosition(newCursorPosition);
        });
      }

      showCreativityDropdown();
      return;
    }
    
    // For other commands (if any), insert and then remove the command token
    const newText = beforeCommand + COMMAND_PREFIX + command.name + SPACE_AFTER_COMMAND + afterCursor;
    textContent = newText;
    textTokens = parseTextToTokens(textContent);
    hideCommandDropdown();
    
    const commandLength = COMMAND_PREFIX.length + command.name.length + SPACE_AFTER_COMMAND.length;
    removeCommandFromText(commandStartIndex, commandLength);
    
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        const newCursorPosition = beforeCommand.length + command.name.length + 2; // +2 for / and space
        setCursorPosition(newCursorPosition);
      });
    }
  }

  async function selectProvider(provider: ProviderReference): Promise<void> {
    try {
      if (onProviderChange) {
        await onProviderChange(provider.id);
      }

      // Update provider label (shows provider and model) and highlight it
      setProviderBadgeLabel(provider.providerName, provider.name);
      providerId = provider.id;
      providerName = provider.providerName;
      badgeHighlight = true;
      setTimeout(() => {
        badgeHighlight = false;
      }, 900);
      
      // Remove the /provider command and any typed query after it (mouse or keyboard)
      removeProviderCommandAndQuery();

      // Hide dropdown
      hideProviderDropdown();
      hideModelDropdown();
    } catch (error) {
      console.error('Error selecting provider:', error);
      hideProviderDropdown();
    }
  }

  async function selectModel(model: ModelReference): Promise<void> {
    try {
      if (onModelChange) {
        await onModelChange(model.name);
      }

      setProviderBadgeLabel(providerName, model.name);
      badgeHighlight = true;
      setTimeout(() => {
        badgeHighlight = false;
      }, 900);

      removeModelCommandAndQuery();
      hideModelDropdown();
    } catch (error) {
      console.error('Error selecting model:', error);
      hideModelDropdown();
    }
  }

  function getCreativityQuery(): string {
    const beforeCursor = textContent.substring(0, cursorPosition);
    const token = `${COMMAND_PREFIX}creativity`;
    const foundIndex = beforeCursor.lastIndexOf(token);
    if (foundIndex === -1) return '';
    const charBefore = foundIndex > 0 ? beforeCursor[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return '';
    const afterNameIndex = foundIndex + token.length;
    const afterName = textContent.substring(afterNameIndex);
    const hasSpace = afterName.startsWith(SPACE_AFTER_COMMAND);
    const queryStart = hasSpace ? afterNameIndex + SPACE_AFTER_COMMAND.length : afterNameIndex;
    const query = textContent.substring(queryStart, cursorPosition);
    return query.trim().toLowerCase();
  }

  function applyCreativityFilter(): void {
    if (!allCreativities || allCreativities.length === 0) return;
    const q = getCreativityQuery();
    filteredCreativities = allCreativities
      .filter(c => fuzzyMatch(c.name, q))
      .slice(0, MAX_DROPDOWN_RESULTS);
    if (filteredCreativities.length === 0) {
      selectedCreativityIndex = -1;
    } else if (selectedCreativityIndex < 0 || selectedCreativityIndex >= filteredCreativities.length) {
      selectedCreativityIndex = 0;
    }
    if (q) {
      // Try to auto-select when exact match ignoring case and emojis
      const norm = (s: string) => s.toLowerCase();
      const exact = filteredCreativities.find(c => norm(c.name) === norm(q));
      if (exact) {
        void selectCreativity(exact);
      }
    }
  }

  function removeCreativityCommandAndQuery(): void {
    const token = `${COMMAND_PREFIX}creativity`;
    const foundIndex = textContent.lastIndexOf(token);
    if (foundIndex === -1) return;
    const charBefore = foundIndex > 0 ? textContent[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return;

    let removalStart = foundIndex;
    let idx = foundIndex + token.length;
    if (textContent[idx] === SPACE_AFTER_COMMAND) {
      idx += SPACE_AFTER_COMMAND.length;
    }
    while (idx < textContent.length) {
      const ch = textContent[idx];
      if (isCharacterWhitespace(ch) || ch === '/' || ch === '@') break;
      idx++;
    }
    const removalEnd = idx;
    const before = textContent.substring(0, removalStart);
    const after = textContent.substring(removalEnd);
    textContent = before + after;
    textTokens = parseTextToTokens(textContent);
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        setCursorPosition(before.length);
      });
    }
  }

  async function showCreativityDropdown(): Promise<void> {
    try {
      allCreativities = getCreativityOptions();
      applyCreativityFilter();
      if (filteredCreativities.length > 0) {
        isCreativityDropdownVisible = true;
        selectedCreativityIndex = 0;
      }
    } catch (error) {
      console.error('Error showing creativity dropdown:', error);
    }
  }

  function hideCreativityDropdown(): void {
    isCreativityDropdownVisible = false;
    filteredCreativities = [];
    selectedCreativityIndex = -1;
    allCreativities = [];
  }

  async function selectCreativity(option: CreativityReference): Promise<void> {
    try {
      if (onCreativityChange) {
        await onCreativityChange(option.id);
      }
      creativityBadge = option.name;
      setProviderBadgeLabel(providerName, modelName);
      badgeHighlight = true;
      setTimeout(() => {
        badgeHighlight = false;
      }, 900);
      removeCreativityCommandAndQuery();
      hideCreativityDropdown();
    } catch (error) {
      console.error('Error selecting creativity:', error);
      hideCreativityDropdown();
    }
  }

  function getProviderQuery(): string {
    const beforeCursor = textContent.substring(0, cursorPosition);
    const providerToken = `${COMMAND_PREFIX}provider`;
    const foundIndex = beforeCursor.lastIndexOf(providerToken);
    if (foundIndex === -1) return '';
    const charBefore = foundIndex > 0 ? beforeCursor[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return '';
    const afterNameIndex = foundIndex + providerToken.length;
    const afterName = textContent.substring(afterNameIndex);
    const hasSpace = afterName.startsWith(SPACE_AFTER_COMMAND);
    const queryStart = hasSpace ? afterNameIndex + SPACE_AFTER_COMMAND.length : afterNameIndex;
    const query = textContent.substring(queryStart, cursorPosition);
    return query.trim().toLowerCase();
  }

  function fuzzyMatch(target: string, query: string): boolean {
    if (!query) return true;
    let ti = 0;
    const t = target.toLowerCase();
    for (const qc of query) {
      ti = t.indexOf(qc, ti);
      if (ti === -1) return false;
      ti++;
    }
    return true;
  }

  function applyProviderFilter(): void {
    if (!allProviders || allProviders.length === 0) return;
    const q = getProviderQuery();
    filteredProviders = allProviders
      .filter(p => fuzzyMatch(p.name, q) || fuzzyMatch(p.providerName, q))
      .slice(0, MAX_DROPDOWN_RESULTS);
    if (filteredProviders.length === 0) {
      selectedProviderIndex = -1;
    } else if (selectedProviderIndex < 0 || selectedProviderIndex >= filteredProviders.length) {
      selectedProviderIndex = 0;
    }
    // Auto-select when there is a single exact name match (paste convenience)
    if (q && filteredProviders.length === 1 && filteredProviders[0].name.toLowerCase() === q) {
      void selectProvider(filteredProviders[0]);
    }
  }

  function removeProviderCommandAndQuery(): void {
    const providerToken = `${COMMAND_PREFIX}provider`;
    const foundIndex = textContent.lastIndexOf(providerToken);
    if (foundIndex === -1) return;
    const charBefore = foundIndex > 0 ? textContent[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return;

    let removalStart = foundIndex;
    let idx = foundIndex + providerToken.length;
    // Optional single space after command
    if (textContent[idx] === SPACE_AFTER_COMMAND) {
      idx += SPACE_AFTER_COMMAND.length;
    }
    // Remove contiguous non-whitespace query chars (stop on space or control tokens)
    while (idx < textContent.length) {
      const ch = textContent[idx];
      if (isCharacterWhitespace(ch) || ch === '/' || ch === '@') break;
      idx++;
    }
    const removalEnd = idx;
    const before = textContent.substring(0, removalStart);
    const after = textContent.substring(removalEnd);
    textContent = before + after;
    textTokens = parseTextToTokens(textContent);
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        setCursorPosition(before.length);
      });
    }
  }

  async function showProviderDropdown(): Promise<void> {
    if (!getProviders) return;
    
    try {
      const providers = await fetchAvailableProviders();
      allProviders = providers;
      applyProviderFilter();
      
      if (filteredProviders.length > 0) {
        isProviderDropdownVisible = true;
        selectedProviderIndex = 0;
      } else {
        // No providers available
        console.warn('No providers available');
      }
    } catch (error) {
      console.error('Error showing provider dropdown:', error);
    }
  }

  function getModelQuery(): string {
    const beforeCursor = textContent.substring(0, cursorPosition);
    const modelToken = `${COMMAND_PREFIX}model`;
    const foundIndex = beforeCursor.lastIndexOf(modelToken);
    if (foundIndex === -1) return '';
    const charBefore = foundIndex > 0 ? beforeCursor[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return '';
    const afterNameIndex = foundIndex + modelToken.length;
    const afterName = textContent.substring(afterNameIndex);
    const hasSpace = afterName.startsWith(SPACE_AFTER_COMMAND);
    const queryStart = hasSpace ? afterNameIndex + SPACE_AFTER_COMMAND.length : afterNameIndex;
    const query = textContent.substring(queryStart, cursorPosition);
    return query.trim().toLowerCase();
  }

  function applyModelFilter(): void {
    if (!allModels || allModels.length === 0) return;
    const q = getModelQuery();
    filteredModels = allModels
      .filter(m => fuzzyMatch(m.name, q))
      .slice(0, MAX_DROPDOWN_RESULTS);
    if (filteredModels.length === 0) {
      selectedModelIndex = -1;
    } else if (selectedModelIndex < 0 || selectedModelIndex >= filteredModels.length) {
      selectedModelIndex = 0;
    }
    if (q && filteredModels.length === 1 && filteredModels[0].name.toLowerCase() === q) {
      void selectModel(filteredModels[0]);
    }
  }

  function removeModelCommandAndQuery(): void {
    const modelToken = `${COMMAND_PREFIX}model`;
    const foundIndex = textContent.lastIndexOf(modelToken);
    if (foundIndex === -1) return;
    const charBefore = foundIndex > 0 ? textContent[foundIndex - 1] : ' ';
    if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return;

    let removalStart = foundIndex;
    let idx = foundIndex + modelToken.length;
    if (textContent[idx] === SPACE_AFTER_COMMAND) {
      idx += SPACE_AFTER_COMMAND.length;
    }
    while (idx < textContent.length) {
      const ch = textContent[idx];
      if (isCharacterWhitespace(ch) || ch === '/' || ch === '@') break;
      idx++;
    }
    const removalEnd = idx;
    const before = textContent.substring(0, removalStart);
    const after = textContent.substring(removalEnd);
    textContent = before + after;
    textTokens = parseTextToTokens(textContent);
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        setCursorPosition(before.length);
      });
    }
  }

  async function showModelDropdown(): Promise<void> {
    if (!getModels || !providerId) return;

    try {
      const models = await fetchAvailableModels();
      allModels = models;
      applyModelFilter();

      if (filteredModels.length > 0) {
        isModelDropdownVisible = true;
        selectedModelIndex = 0;
      } else {
        console.warn('No models available');
      }
    } catch (error) {
      console.error('Error showing model dropdown:', error);
    }
  }

  function handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    
    // Handle clicks on file mentions to remove them
    if (target.classList.contains('file-mention')) {
      const filePath = target.dataset.path;
      if (filePath) {
        removeFileReference(filePath);
      }
    }
  }

  function createFileRemovalPattern(file: FileReference): RegExp {
    const fullFileName = `${file.basename}.${file.extension}`;
    const escapedFileName = fullFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${MENTION_PREFIX}${escapedFileName}\\s?`, 'g');
  }

  function removeCommandFromText(commandStartIndex: number, commandLength: number): void {
    if (commandStartIndex === -1) return;
    
    const beforeCommand = textContent.substring(0, commandStartIndex);
    const afterCommand = textContent.substring(commandStartIndex + commandLength);
    
    // Update content state
    textContent = beforeCommand + afterCommand;
    textTokens = parseTextToTokens(textContent);
    
    // Update display and cursor position
    if (contentElement) {
      updateContentDisplay();
      tick().then(() => {
        setCursorPosition(beforeCommand.length);
      });
    }
  }

  function removeFileReference(filePath: string): void {
    selectedFiles = selectedFiles.filter(path => path !== filePath);
    
    // Remove the @filename.extension mention from text content
    const file = getFiles?.()?.find(f => f.path === filePath);
    if (file) {
      const removalPattern = createFileRemovalPattern(file);
      textContent = textContent.replace(removalPattern, '');
      textTokens = parseTextToTokens(textContent);
      updateContentDisplay();
    }
  }

  function submitAction(): void {
    dispatch('submit', { 
      text: textContent, 
      selectedFiles 
    });
  }

  // Handle backspace/delete to clean up broken file mentions
  function handleKeyup(event: KeyboardEvent): void {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      // Extract currently mentioned files from tokens
      const currentlyMentionedFiles = textTokens
        .filter(token => token.type === 'file' && token.filePath)
        .map(token => token.filePath!);
      
      // Remove any selected files that are no longer mentioned
      const filesToRemove = selectedFiles.filter(filePath => 
        !currentlyMentionedFiles.includes(filePath)
      );
      
      if (filesToRemove.length > 0) {
        selectedFiles = selectedFiles.filter(path => 
          currentlyMentionedFiles.includes(path)
        );
      }
    }
  }
</script>

<div class="local-gpt-action-palette-shell">
  <div
    bind:this={contentElement}
    class="local-gpt-action-palette"
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-label={placeholder}
    on:keydown={handleKeydown}
    on:input={handleInput}
    on:keyup={handleKeyup}
    on:click={handleContentClick}
    data-placeholder={placeholder}
    spellcheck="false"
  ></div>
  
  {#if isDropdownVisible && filteredFiles.length > 0}
    <div bind:this={dropdownElement} class="local-gpt-dropdown">
      {#each filteredFiles as file, index}
        <div
          class="local-gpt-dropdown-item {index === selectedDropdownIndex ? 'local-gpt-selected' : ''}"
          role="option"
          tabindex="0"
          aria-selected={index === selectedDropdownIndex}
          on:click={() => insertFileAtCursor(file)}
          on:keydown={(event) => event.key === 'Enter' && insertFileAtCursor(file)}
        >
          <span class="local-gpt-file-name">{file.basename}.{file.extension}</span>
          <span class="local-gpt-file-path">{file.path}</span>
        </div>
      {/each}
    </div>
  {/if}
  
  {#if isCommandDropdownVisible && filteredCommands.length > 0}
    <div bind:this={commandDropdownElement} class="local-gpt-dropdown">
      {#each filteredCommands as command, index}
        <div
          class="local-gpt-dropdown-item {index === selectedCommandIndex ? 'local-gpt-selected' : ''}"
          role="option"
          tabindex="0"
          aria-selected={index === selectedCommandIndex}
          on:click={() => insertCommandAtCursor(command)}
          on:keydown={(event) => event.key === 'Enter' && insertCommandAtCursor(command)}
        >
          <span class="local-gpt-command-name">/{command.name}</span>
          <span class="local-gpt-command-description">{command.description}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if isModelDropdownVisible && filteredModels.length > 0}
    <div bind:this={modelDropdownElement} class="local-gpt-dropdown">
      {#each filteredModels as model, index}
        <div
          class="local-gpt-dropdown-item {index === selectedModelIndex ? 'local-gpt-selected' : ''}"
          role="option"
          tabindex="0"
          aria-selected={index === selectedModelIndex}
          on:click={() => selectModel(model)}
          on:keydown={(event) => {
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              selectModel(model);
            }
          }}
        >
          <span class="local-gpt-provider-name">{model.name}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if isCreativityDropdownVisible && filteredCreativities.length > 0}
    <div bind:this={creativityDropdownElement} class="local-gpt-dropdown">
      {#each filteredCreativities as item, index}
        <div
          class="local-gpt-dropdown-item {index === selectedCreativityIndex ? 'local-gpt-selected' : ''}"
          role="option"
          tabindex="0"
          aria-selected={index === selectedCreativityIndex}
          on:click={() => selectCreativity(item)}
          on:keydown={(event) => {
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              selectCreativity(item);
            }
          }}
        >
          <span class="local-gpt-provider-name">{item.name}</span>
        </div>
      {/each}
    </div>
  {/if}
  
  {#if isProviderDropdownVisible && filteredProviders.length > 0}
    <div bind:this={providerDropdownElement} class="local-gpt-dropdown">
      {#each filteredProviders as provider, index}
        <div
          class="local-gpt-dropdown-item {index === selectedProviderIndex ? 'local-gpt-selected' : ''}"
          role="option"
          tabindex="0"
          aria-selected={index === selectedProviderIndex}
          on:click={() => selectProvider(provider)}
          on:keydown={(event) => {
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              selectProvider(provider);
            }
          }}
        >
          <div class="local-gpt-provider-header">
            <span class="local-gpt-provider-name">{provider.providerName}</span>
            {#if provider.providerUrl}
              <span class="local-gpt-provider-url">{provider.providerUrl}</span>
            {/if}
          </div>
          <span class="local-gpt-provider-model">{provider.name}</span>
        </div>
      {/each}
    </div>
  {/if}
  
  {#if providerLabel}
    <div class="local-gpt-provider-badge" aria-hidden="true">
      <div class={badgeHighlight ? "local-gpt-provider-badge-label local-gpt-badge-highlight" : "local-gpt-provider-badge-label"}>{providerLabel}</div>
    </div>
  {/if}
</div>
