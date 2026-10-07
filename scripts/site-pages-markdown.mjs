// Reads the customer documents in docs/legal/ for the site pages: headings,
// paragraphs (a line break inside one is kept, for address blocks), bullet
// lists with one nested level, numbered lists, tables, boxed notes (`>` lines),
// rules (`---`), **bold**, *italic*, [links](https://…), bare https links,
// email addresses and [PLACEHOLDER: …] blanks. That is all those documents use.

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeText(text) {
  return text.replace(/[&<>"]/g, (character) => TEXT_ESCAPES[character]);
}

// A blank the owner still has to fill in shows as a marked gap, never as text
// a reader could take for the real value.
function placeholder(_, what) {
  return `<mark class="blank">[${(what ?? 'to be filled in').trim()}]</mark>`;
}

function emphasis(html) {
  return html
    .replace(/\[PLACEHOLDER(?::([^\]]+))?\]/g, placeholder)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, '$1<em>$2</em>');
}

// Written links are set aside first, so the bare-link pass never links a
// link's own label or address a second time.
export function inlineHtml(text) {
  const links = [];
  const marked = text.replace(
    /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_, label, url) => `\uE000${links.push({ label, url }) - 1}\uE000`,
  );
  return emphasis(escapeText(marked))
    .replace(/https:\/\/[^\s<]*[^\s<.,;:)]/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(
      /\b[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi,
      (email) => `<a href="mailto:${email}">${email}</a>`,
    )
    .replace(/\uE000(\d+)\uE000/g, (_, index) => {
      const { label, url } = links[Number(index)];
      return `<a href="${escapeText(url)}">${emphasis(escapeText(label))}</a>`;
    });
}

// Numbered sections ("## 8. Refunds") get stable anchors (#section-8) so a
// support answer can link a clause; other headings get a slug of their words.
function headingId(text) {
  const numbered = /^(\d+)\.\s/.exec(text);
  if (numbered) return `section-${numbered[1]}`;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function classify(line) {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return { kind: 'heading', level: heading[1].length, text: heading[2].trim() };
  if (/^>\s?/.test(line)) return { kind: 'note', text: line.replace(/^>\s?/, '') };
  if (/^\s*---+\s*$/.test(line)) return { kind: 'rule' };
  if (line.trimStart().startsWith('|')) return { kind: 'row', cells: tableCells(line) };
  if (line.startsWith('- ')) return { kind: 'item', text: line.slice(2).trim() };
  const numbered = /^\d+\.\s+(.*)$/.exec(line);
  if (numbered) return { kind: 'numbered', text: numbered[1].trim() };
  if (/^\s{2,}- /.test(line)) return { kind: 'subitem', text: line.trim().slice(2).trim() };
  if (/^\s{2,}\S/.test(line)) return { kind: 'continuation', text: line.trim() };
  return { kind: 'text', text: line.trim() };
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function addLine(state, part) {
  const current = state.current;
  if (part.kind === 'row') {
    if (current?.type !== 'table') {
      state.close();
      state.current = { type: 'table', head: part.cells, rows: [] };
    } else if (current.rows.length > 0 || !isSeparatorRow(part.cells)) {
      current.rows.push(part.cells);
    }
    return;
  }
  if (part.kind === 'item' || part.kind === 'numbered') {
    const type = part.kind === 'item' ? 'list' : 'ordered';
    if (current?.type !== type) state.close();
    state.current ??= { type, items: [] };
    state.current.items.push({ text: part.text, children: [] });
    return;
  }
  if (
    (current?.type === 'list' || current?.type === 'ordered') &&
    (part.kind === 'subitem' || part.kind === 'continuation' || part.kind === 'text')
  ) {
    const last = current.items[current.items.length - 1];
    const lastChild = last.children[last.children.length - 1];
    if (part.kind === 'subitem') last.children.push(part.text);
    else if (lastChild !== undefined) last.children[last.children.length - 1] += ` ${part.text}`;
    else last.text = `${last.text} ${part.text}`;
    return;
  }
  if (current?.type !== 'paragraph') state.close();
  state.current ??= { type: 'paragraph', lines: [] };
  state.current.lines.push(part.text);
}

export function markdownBlocks(source) {
  const blocks = [];
  const state = {
    current: null,
    close() {
      if (this.current) blocks.push(this.current);
      this.current = null;
    },
  };
  let note = null;
  const closeNote = () => {
    if (note === null) return;
    blocks.push({ type: 'note', blocks: markdownBlocks(note.join('\n')) });
    note = null;
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const part = line.trim() === '' ? { kind: 'blank' } : classify(line);
    if (part.kind === 'note') {
      state.close();
      note ??= [];
      note.push(part.text);
      continue;
    }
    closeNote();
    if (part.kind === 'blank') {
      state.close();
    } else if (part.kind === 'heading') {
      state.close();
      blocks.push({ type: 'heading', level: part.level, text: part.text });
    } else if (part.kind === 'rule') {
      state.close();
      blocks.push({ type: 'rule' });
    } else {
      addLine(state, part);
    }
  }
  state.close();
  closeNote();
  return blocks;
}

// The document's first top-level heading is its title; `shift` demotes the
// headings of a document shown inside another page (a notice becomes a section).
export function readDocument(source) {
  const blocks = markdownBlocks(source);
  const titleAt = blocks.findIndex((block) => block.type === 'heading' && block.level === 1);
  if (titleAt === -1) throw new Error('A site document needs a top-level # title');
  return {
    title: blocks[titleAt].text,
    blocks: blocks.filter((_, index) => index !== titleAt),
  };
}

function listHtml(tag, items) {
  const entries = items.map(({ text, children }) => {
    const nested = children.length > 0 ? listHtml('ul', children.map(leaf)) : '';
    return `<li>${inlineHtml(text)}${nested}</li>`;
  });
  return `<${tag}>${entries.join('')}</${tag}>`;
}

function leaf(text) {
  return { text, children: [] };
}

// Wide tables scroll inside their own box on a phone instead of the page.
function tableHtml({ head, rows }) {
  const cell = (tag) => (text) => `<${tag}>${inlineHtml(text)}</${tag}>`;
  const headRow = `<tr>${head.map(cell('th')).join('')}</tr>`;
  const bodyRows = rows.map((row) => `<tr>${row.map(cell('td')).join('')}</tr>`).join('');
  return `<div class="table-scroll"><table><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
}

// `ids` is shared by every document on one page, so two sections with the same
// heading still get different anchors.
export function blocksHtml(blocks, { shift = 0, ids = new Set() } = {}) {
  const uniqueId = (text) => {
    const base = headingId(text);
    let id = base;
    for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const level = Math.min(block.level + shift, 6);
        return `<h${level} id="${uniqueId(block.text)}">${inlineHtml(block.text)}</h${level}>`;
      }
      if (block.type === 'list') return listHtml('ul', block.items);
      if (block.type === 'ordered') return listHtml('ol', block.items);
      if (block.type === 'table') return tableHtml(block);
      if (block.type === 'rule') return '<hr />';
      if (block.type === 'note') {
        return `<aside class="note">${blocksHtml(block.blocks, { shift, ids })}</aside>`;
      }
      return `<p>${block.lines.map(inlineHtml).join('<br />')}</p>`;
    })
    .join('\n');
}
