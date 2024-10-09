import { preprocessContent, splitContent } from '../src/text-processing';

describe('Text Processing', () => {
  describe('preprocessContent', () => {
    it('should remove frontmatter from content', () => {
      const input = `---
title: Test
date: 2023-04-01
---
# Real content`;
      const expected = '# Real content';
      expect(preprocessContent(input)).toBe(expected);
    });

    it('should remove code blocks from content', () => {
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

    it('should remove empty headers', () => {
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

    it('should compress multiple empty lines', () => {
      const input = `Line 1


Line 2



Line 3`;
      const expected = `Line 1

Line 2

Line 3`;
      expect(preprocessContent(input)).toBe(expected);
    });

    it('should handle text with multiple code blocks', () => {
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

    it('should remove empty headers and compress multiple empty lines', () => {
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

    it('should remove frontmatter and code blocks', () => {
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

    it('should handle text without changes', () => {
      const input = 'Simple text without any special formatting.';
      expect(preprocessContent(input)).toBe(input);
    });

    it('should handle text with only frontmatter', () => {
      const input = `---
title: Just Frontmatter
date: 2023-04-01
---`;
      expect(preprocessContent(input)).toBe(input);
    });
  });

  describe('splitContent', () => {
    it('should split content by headers of different levels', () => {
      const input = `# Header 1
Content 1
## Header 2
Content 2
### Header 3
Content 3`;
      const expected = [
        '# Header 1\nContent 1',
        '## Header 2\nContent 2',
        '### Header 3\nContent 3'
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle lists correctly', () => {
      const input = `# Header
- List item 1
- List item 2
  - Nested item
- List item 3

Paragraph after list.`;
      const expected = [
        `# Header
- List item 1
- List item 2
  - Nested item
- List item 3

Paragraph after list.`
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    // TODO: improve
    // Maybe it's better to split content with header and then put the rest to the next chunk
    it('should respect maximum chunk size', () => {
      const longParagraph = 'A'.repeat(1500);
      const input = `# Header
${longParagraph}
## Another header
Some more content`;
      const result = splitContent(input);
      expect(result).toHaveLength(4);
      expect(result[0]).toBe('# Header');
      expect(result[1].length).toBeLessThanOrEqual(1000);
      expect(result[1]).toMatch(/^A+$/);
      expect(result[2]).toMatch(/^A+$/);
      expect(result[3]).toMatch('## Another header\nSome more content');
    });

    it('should handle complex document structure', () => {
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
      const expected = [
        `# Main Header
Intro paragraph`,
        `## Subheader 1
- List item 1
- List item 2
  - Nested item 1
  - Nested item 2
- List item 3

Some text after the list.`,
        `## Subheader 2
Another paragraph.`,
        `### Sub-subheader
- Another list
- With items

Final paragraph.`
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle multiple consecutive headers of different levels', () => {
      const input = `# Header 1
## Header 2
### Header 3
#### Header 4
Content`;
      const expected = [
        '# Header 1',
        '## Header 2',
        '### Header 3',
        '#### Header 4\nContent'
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle nested lists correctly', () => {
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
      const expected = [
        `# Header
- List item 1
  - Nested item 1
  - Nested item 2
    - Deeply nested item
- List item 2
  1. Numbered nested item 1
  2. Numbered nested item 2
- List item 3

Paragraph after list.`
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle alternating headers and long paragraphs', () => {
      const longParagraph = 'A'.repeat(800);
      const input = `# Header 1
${longParagraph}
## Header 2
${longParagraph}
### Header 3
${longParagraph}`;
      const expected = [
        `# Header 1
${'A'.repeat(800)}`,
        `## Header 2
${'A'.repeat(800)}`,
        `### Header 3
${'A'.repeat(800)}`
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle empty input', () => {
      expect(splitContent('')).toEqual([]);
    });

    // TODO: improve
    it('should handle very long header', () => {
      const longHeader = '#'.repeat(100) + ' ' + 'A'.repeat(900);
      const input = `${longHeader}\nSome content`;
      const expected = [
        '#'.repeat(100),
        'A'.repeat(900),
        'Some content'
      ];
      expect(splitContent(input)).toEqual(expected);
    });

    it('should handle very long list', () => {
      const listItems = Array(100).fill('- List item').join('\n');
      const input = `# Header\n${listItems}`;
      const expected = [`# Header\n${listItems}`];
      expect(splitContent(input)).toEqual(expected);
    });
  });
});