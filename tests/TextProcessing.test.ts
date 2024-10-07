import { preprocessContent, splitContent } from '../src/text-processing';

describe('Text Processing', () => {
  describe('preprocessContent', () => {
    test('removes frontmatter', () => {
      const input = `---
title: Test
date: 2023-04-01
---
# Real content`;
      const expected = '# Real content';
      expect(preprocessContent(input)).toBe(expected);
    });

    test('removes code blocks', () => {
      const input = `# Title
Some text
\`\`\`
code block
\`\`\`
More text`;
      const expected = `# Title
Some text

More text`;
      expect(preprocessContent(input)).toBe(expected);
    });

    test('removes empty headers', () => {
      const input = `# Header 1
Content
## 
# Header 2
More content`;
      const expected = `# Header 1
Content
# Header 2
More content`;
      expect(preprocessContent(input)).toBe(expected);
    });

    test('compresses multiple empty lines', () => {
      const input = `Line 1


Line 2



Line 3`;
      const expected = `Line 1

Line 2

Line 3`;
      expect(preprocessContent(input)).toBe(expected);
    });

    test('handles text with multiple code blocks', () => {
      const input = `# Title
\`\`\`
code block 1
\`\`\`
Some text
\`\`\`
code block 2
\`\`\`
More text`;
      const expected = `# Title

Some text

More text`;
      expect(preprocessContent(input)).toBe(expected);
    });

    test('removes empty headers and compresses multiple empty lines', () => {
      const input = `# Header 1
Content
## 
# Header 2
More content


Extra line`;
      const expected = `# Header 1
Content
# Header 2
More content

Extra line`;
      expect(preprocessContent(input)).toBe(expected);
    });

    test('removes frontmatter and code blocks', () => {
      const input = `---
title: Test
date: 2023-04-01
---
# Real content
Some text
\`\`\`
code block
\`\`\`
More text`;
      const expected = `# Real content
Some text

More text`;
      expect(preprocessContent(input)).toBe(expected);
    });
  });

  describe('splitContent', () => {
    test('splits by headers of different levels', () => {
      const input = `# Header 1
Content 1
## Header 2
Content 2
### Header 3
Content 3`;
      const result = splitContent(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('# Header 1');
      expect(result[1]).toContain('## Header 2');
      expect(result[2]).toContain('### Header 3');
    });

    test('handles lists correctly', () => {
      const input = `# Header
- List item 1
- List item 2
  - Nested item
- List item 3

Paragraph after list.`;
      const result = splitContent(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('# Header');
      expect(result[0]).toContain('- List item 1');
      expect(result[0]).toContain('  - Nested item');
      expect(result[0]).toContain('Paragraph after list.');
    });

    test('respects maximum chunk size', () => {
      const longParagraph = 'A'.repeat(1500);
      const input = `# Header
${longParagraph}
## Another header
Some more content`;
      const result = splitContent(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('# Header');
      expect(result[0].length).toBeLessThanOrEqual(1000);
      expect(result[1]).toContain('A');
      expect(result[1].length).toBeGreaterThan(1000);
      expect(result[2]).toContain('## Another header');
      expect(result[2]).toContain('Some more content');
    });

    test('handles complex document structure', () => {
      const input = `# Main Header
Intro paragraph

## Subheader 1
- List item 1
- List item 2
  - Nested item 1
  - Nested item 2
- List item 3

Some text after the list.

## Subheader 2
Another paragraph.

### Sub-subheader
- Another list
- With items

Final paragraph.`;
      const result = splitContent(input);
      expect(result).toHaveLength(4);
      expect(result[0]).toContain('# Main Header');
      expect(result[1]).toContain('## Subheader 1');
      expect(result[2]).toContain('## Subheader 2');
      expect(result[3]).toContain('### Sub-subheader');
    });

    test('handles multiple consecutive headers of different levels', () => {
      const input = `# Header 1
## Header 2
### Header 3
#### Header 4
Content`;
      const result = splitContent(input);
      expect(result).toHaveLength(4);
      expect(result[0]).toContain('# Header 1');
      expect(result[1]).toContain('## Header 2');
      expect(result[2]).toContain('### Header 3');
      expect(result[3]).toContain('#### Header 4');
      expect(result[3]).toContain('Content');
    });

    test('handles nested lists correctly', () => {
      const input = `# Header
- List item 1
  - Nested item 1
  - Nested item 2
    - Deeply nested item
- List item 2
  1. Numbered nested item 1
  2. Numbered nested item 2
- List item 3

Paragraph after list.`;
      const result = splitContent(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('# Header');
      expect(result[0]).toContain('- List item 1');
      expect(result[0]).toContain('  - Nested item 1');
      expect(result[0]).toContain('    - Deeply nested item');
      expect(result[0]).toContain('  1. Numbered nested item 1');
      expect(result[0]).toContain('Paragraph after list.');
    });

    test('handles alternating headers and long paragraphs', () => {
      const longParagraph = 'A'.repeat(800);
      const input = `# Header 1
${longParagraph}
## Header 2
${longParagraph}
### Header 3
${longParagraph}`;
      const result = splitContent(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('# Header 1');
      expect(result[1]).toContain('## Header 2');
      expect(result[2]).toContain('### Header 3');
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      });
    });
  });

  describe('preprocessContent - additional tests', () => {
    test('handles text without changes', () => {
      const input = 'Simple text without any special formatting.';
      expect(preprocessContent(input)).toBe(input);
    });

    test('handles text with only frontmatter', () => {
      const input = `---
title: Just Frontmatter
date: 2023-04-01
---`;
      expect(preprocessContent(input)).toBe(input);
    });

    test('handles text with multiple code blocks', () => {
      const input = `# Title
\`\`\`
code block 1
\`\`\`
Some text
\`\`\`
code block 2
\`\`\`
More text`;
      const expected = `# Title

Some text

More text`;
      expect(preprocessContent(input)).toBe(expected);
    });
  });

  describe('splitContent - additional tests', () => {
    test('handles empty input', () => {
      expect(splitContent('')).toEqual([]);
    });

    test('handles very long header', () => {
      const longHeader = '#'.repeat(100) + ' ' + 'A'.repeat(900);
      const input = `${longHeader}\nSome content`;
      const result = splitContent(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('#'.repeat(100));
      expect(result[1]).toContain('Some content');
    });

    test('handles multiple consecutive headers', () => {
      const input = `# Header 1
## Header 2
### Header 3
Content`;
      const result = splitContent(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('# Header 1');
      expect(result[1]).toContain('## Header 2');
      expect(result[2]).toContain('### Header 3');
      expect(result[2]).toContain('Content');
    });

    test('handles very long list', () => {
      const listItems = Array(100).fill('- List item').join('\n');
      const input = `# Header\n${listItems}`;
      const result = splitContent(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('# Header');
      expect(result[0]).toContain('- List item');
    });

    test('handles alternating headers and long paragraphs', () => {
      const longParagraph = 'A'.repeat(800);
      const input = `# Header 1
${longParagraph}
## Header 2
${longParagraph}
### Header 3
${longParagraph}`;
      const result = splitContent(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('# Header 1');
      expect(result[1]).toContain('## Header 2');
      expect(result[2]).toContain('### Header 3');
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      });
    });
  });
});