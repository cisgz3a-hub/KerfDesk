// Reads the customer documents in docs/legal/ for the site pages: headings,
// paragraphs, bullet lists (continuation lines indented), **bold**, bare https
// links, @kerfdesk.com email addresses and [PLACEHOLDER: …] blanks. That is all
// those documents use. Blockquotes are the documents' notes to the owner and
// are never published.

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

export function escapeText(text) {
  return text.replace(/[&<>]/g, (character) => TEXT_ESCAPES[character]);
}

// A blank the owner still has to fill in shows as a marked gap, never as text
// a reader could take for the real value.
function placeholder(_, what) {
  return `<mark class="blank">[${(what ?? 'to be filled in').trim()}]</mark>`;
}

export function inlineHtml(text) {
  return escapeText(text)
    .replace(/\[PLACEHOLDER(?::([^\]]+))?\]/g, placeholder)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/https:\/\/[^\s<]*[^\s<.,;:)]/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\b[a-z]+@kerfdesk\.com\b/g, (email) => `<a href="mailto:${email}">${email}</a>`);
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

function classify(line) {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return { kind: 'heading', level: heading[1].length, text: heading[2].trim() };
  if (line.startsWith('>')) return { kind: 'note' };
  if (line.startsWith('- ')) return { kind: 'item', text: line.slice(2).trim() };
  if (/^\s{2,}\S/.test(line)) return { kind: 'continuation', text: line.trim() };
  return { kind: 'text', text: line.trim() };
}

export function markdownBlocks(source) {
  const blocks = [];
  let current = null;
  let inNote = false;
  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      close();
      inNote = false;
      continue;
    }
    const part = classify(line);
    if (inNote || part.kind === 'note') {
      inNote = true;
      continue;
    }
    if (part.kind === 'heading') {
      close();
      blocks.push({ type: 'heading', level: part.level, text: part.text });
    } else if (part.kind === 'item') {
      if (current?.type !== 'list') close();
      current ??= { type: 'list', items: [] };
      current.items.push(part.text);
    } else if (current?.type === 'list') {
      const last = current.items.length - 1;
      current.items[last] = `${current.items[last]} ${part.text}`;
    } else {
      current ??= { type: 'paragraph', text: '' };
      current.text = current.text === '' ? part.text : `${current.text} ${part.text}`;
    }
  }
  close();
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
      if (block.type === 'list') {
        return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`;
      }
      return `<p>${inlineHtml(block.text)}</p>`;
    })
    .join('\n');
}
