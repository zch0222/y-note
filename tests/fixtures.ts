export interface MarkdownFixture {
  name: string
  source: string
}

export const markdownFixtures: MarkdownFixture[] = [
  { name: 'empty document', source: '' },
  { name: 'whitespace only', source: '   \n\n\t\n' },
  { name: 'atx headings', source: '# Title\n\n## Sub ##\n\n###### Six\n' },
  { name: 'setext headings', source: 'Title\n=====\n\nSub\n---\n' },
  {
    name: 'inline marks',
    source: 'a **bold** and *em* and _under_ and ~~del~~ and `code`\n',
  },
  {
    name: 'links and images',
    source:
      '[text](https://example.com "t") and ![alt](img.png)\n\n[ref][id]\n\n[id]: https://example.com "T"\n',
  },
  {
    name: 'nested lists',
    source: '- one\n- two\n  - nested\n\n1. first\n2. second\n',
  },
  { name: 'parenthesized ordered list', source: '1) one\n2) two\n' },
  { name: 'task list', source: '* [ ] todo\n* [x] done\n* [X] Done\n' },
  { name: 'blockquote', source: '> quoted\n> second\n>\n> > deep\n' },
  {
    name: 'nested quote and list',
    source: '> + item\n>   continued\n>\n> > deep\n',
  },
  {
    name: 'table with alignment',
    source: '| left | center | right |\n|:-----|:------:|------:|\n| a | b | c |\n',
  },
  {
    name: 'table without outer pipes',
    source: 'a | b\n--- | ---\n1 | 2\n',
  },
  {
    name: 'fenced code with pseudo markdown',
    source: '```ts\nconst x = 1\n\n# not a heading\n- not a list\n```\n',
  },
  { name: 'tilde fence', source: '~~~js\nlet a = 1\n~~~\n' },
  { name: 'indented code', source: '    code line\n    more code\n' },
  {
    name: 'raw html',
    source: '<div>\nraw *text*\n</div>\n\npara\n',
  },
  {
    name: 'yaml front matter',
    source: '---\ntitle: hi\ntags: [a, b]\n---\n\nbody\n',
  },
  {
    name: 'toml front matter',
    source: '+++\ntitle = "x"\n+++\n\nbody\n',
  },
  { name: 'thematic breaks', source: '---\n\n***\n\n___\n' },
  {
    name: 'duplicate tokens',
    source: 'same *same* same\n\nsame\n\n- same\n- same\n',
  },
  {
    name: 'cjk emoji and combining marks',
    source: '中文 **粗体** e\u0301 👨‍👩‍👧‍👦\n\n| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |\n',
  },
  {
    name: 'hard breaks',
    source: 'line one  \nline two\\\nthree\n',
  },
  {
    name: 'trailing blank lines',
    source: 'a  \n\n\n\n',
  },
  {
    name: 'escaped punctuation',
    source: '\\*not emphasis\\* \\[not link\\] \\`not code\\`\n',
  },
  {
    name: 'inline html',
    source: 'a <span>b</span> c\n',
  },
  {
    name: 'crlf document',
    source:
      '# T\r\n\r\npara **x** with [l](u)  \r\nnext\r\n\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n> quote\r\n',
  },
  { name: 'cr only document', source: '# T\r\rpara\r' },
  { name: 'no final newline', source: '# T\n\npara without newline' },
  {
    name: 'long mixed document',
    source: [
      '---',
      'title: Mixed',
      '---',
      '',
      '# Heading',
      '',
      'A paragraph with **bold**, *italic*, `code`, [link](https://x), and a footnote-like [ref].',
      '',
      '> Quote with a list:',
      '>',
      '> - item one',
      '> - item two',
      '',
      '1. ordered',
      '2. list',
      '',
      '| name | value |',
      '| --- | ---: |',
      '| alpha | 1 |',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
      '---',
      '',
      'Final paragraph.',
      '',
    ].join('\n'),
  },
]
