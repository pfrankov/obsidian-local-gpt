import { preparePrompt } from '../src/utils';
import { SELECTION_KEYWORD, CONTEXT_KEYWORD, CONTEXT_CONDITION_START, CONTEXT_CONDITION_END } from '../src/defaultSettings';

describe('Utils', () => {
  test('preparePrompt with selection', () => {
    const prompt = `Process this: ${SELECTION_KEYWORD}`;
    const selectedText = 'Selected text';
    const context = 'Some context';

    const result = preparePrompt(prompt, selectedText, context);

    expect(result).toBe('Process this: Selected text\n\nContext:\nSome context');
  });

  test('preparePrompt with context keyword', () => {
    const prompt = `Process this with context: ${CONTEXT_KEYWORD}`;
    const selectedText = 'Selected text';
    const context = 'Some context';

    const result = preparePrompt(prompt, selectedText, context);

    expect(result).toBe('Process this with context: Some context\n\nSelected text');
  });

  test('preparePrompt with empty prompt', () => {
    const result = preparePrompt('', 'Selected text', 'Some context');
    expect(result).toBe('Selected text\n\nContext:\nSome context');
  });

  test('preparePrompt with empty selection and context', () => {
    const result = preparePrompt('Process this:', '', '');
    expect(result).toBe('Process this:');
  });

  test('preparePrompt with context condition and non-empty context', () => {
    const prompt = `Before ${CONTEXT_CONDITION_START}Context: ${CONTEXT_KEYWORD}${CONTEXT_CONDITION_END} After`;
    const result = preparePrompt(prompt, 'Selected text', 'Some context');
    expect(result).toBe('BeforeContext: Some contextAfter\n\nSelected text');
  });

  test('preparePrompt with context condition and empty context', () => {
    const prompt = `Before ${CONTEXT_CONDITION_START}Context: ${CONTEXT_KEYWORD}${CONTEXT_CONDITION_END} After`;
    const result = preparePrompt(prompt, 'Selected text', '');
    expect(result).toBe('BeforeAfter\n\nSelected text');
  });

  test('preparePrompt with multiple context conditions', () => {
    const prompt = `${CONTEXT_CONDITION_START}Start${CONTEXT_CONDITION_END} Middle ${CONTEXT_CONDITION_START}End${CONTEXT_CONDITION_END}`;
    const result = preparePrompt(prompt, 'Selected text', 'Some context');
    expect(result).toBe(`${CONTEXT_CONDITION_START}Start${CONTEXT_CONDITION_END} Middle ${CONTEXT_CONDITION_START}End${CONTEXT_CONDITION_END}\n\nSelected text\n\nContext:\nSome context`);
  });

  test('preparePrompt with mismatched context conditions', () => {
    const prompt = `${CONTEXT_CONDITION_START}Incomplete ${CONTEXT_CONDITION_START}Condition${CONTEXT_CONDITION_END}`;
    const result = preparePrompt(prompt, 'Selected text', 'Some context');
    expect(result).toBe(`${CONTEXT_CONDITION_START}Incomplete ${CONTEXT_CONDITION_START}Condition${CONTEXT_CONDITION_END}\n\nSelected text\n\nContext:\nSome context`);
  });

  test('preparePrompt with selection and context keywords in reverse order', () => {
    const prompt = `Context: ${CONTEXT_KEYWORD}\nSelection: ${SELECTION_KEYWORD}`;
    const result = preparePrompt(prompt, 'Selected text', 'Some context');
    expect(result).toBe('Context: Some context\nSelection: Selected text');
  });
});