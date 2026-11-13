"""Small EPUB passages with a separate, locked sidebar cursor. Anx is read-only."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import sqlite3
import sys
from urllib.parse import unquote
from zipfile import ZipFile
from lxml import etree

ROOT = Path(os.environ.get('SIDEBAR_ANX_ROOT', '/srv/books/anx'))
STATE_DIR = Path(os.environ.get('SIDEBAR_BOOK_STATE_DIR', '/srv/paseo-sidebar/data/book-reader'))
LIMIT = 160
PARSER = etree.XMLParser(resolve_entities=False, no_network=True, recover=True)


def books():
    with sqlite3.connect(f'file:{ROOT / "database7.db"}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        return [dict(r) for r in db.execute('SELECT id,title,file_path,last_read_position,reading_percentage FROM tb_books WHERE is_deleted=0 ORDER BY update_time DESC') if str(r['file_path']).lower().endswith('.epub')]


def epub(book):
    file = (ROOT / 'data' / book['file_path']).resolve()
    if not file.is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('书籍路径无效')
    z = ZipFile(file)
    container = etree.fromstring(z.read('META-INF/container.xml'), PARSER)
    opf = container.xpath('//*[local-name()="rootfile"]/@full-path')[0]
    package = etree.fromstring(z.read(opf), PARSER)
    manifest = {x.get('id'): x.get('href') for x in package.xpath('//*[local-name()="manifest"]/*')}
    spine = [posixpath.normpath(posixpath.join(posixpath.dirname(opf), unquote(manifest[x.get('idref')].split('#')[0]))) for x in package.xpath('//*[local-name()="spine"]/*')]
    return z, spine


def chapter(z, name):
    root = etree.fromstring(z.read(name), PARSER)
    body = root.xpath('//*[local-name()="body"]')
    if not body:
        return root, '', []
    body = body[0]
    blocks = body.xpath('.//*[local-name()="p" or local-name()="h1" or local-name()="h2" or local-name()="h3" or local-name()="h4" or local-name()="li" or local-name()="blockquote" or local-name()="pre"]')
    selected = set(blocks)
    blocks = [b for b in blocks if not any(a in selected for a in b.iterancestors())]
    if not blocks:
        blocks = [body]
    text, offsets = '', []
    for block in blocks:
        s = re.sub(r'\s+', ' ', ''.join(block.itertext())).strip()
        if not s:
            continue
        if text:
            text += '\n\n'
        offsets.append((block, len(text)))
        text += s
    return root, text, offsets


def pages(text):
    result = []
    start = 0
    while start < len(text):
        end = min(start + LIMIT, len(text))
        if end < len(text):
            breaks = [m.end() + start for m in re.finditer(r'[。！？；\n]', text[start:end]) if m.end() >= LIMIT // 2]
            if breaks:
                end = breaks[-1]
        result.append((start, end, text[start:end]))
        start = end
    return result


def anx_cursor(book, z, spine):
    cfi = book.get('last_read_position') or ''
    if not cfi:
        return 0, 0, 'Anx 尚无阅读位置，从书首开始'
    try:
        raw = cfi.removeprefix('epubcfi(').removesuffix(')')
        package, content = raw.split('!', 1)
        section = int(re.findall(r'/(\d+)', re.sub(r'\[[^\]]*\]', '', package))[-1]) // 2 - 1
        root, text, offsets = chapter(z, spine[section])
        parts = content.split(',')
        point = parts[0] + (parts[1] if len(parts) > 1 else '')
        point = re.sub(r'\[[^\]]*\]', '', point)
        node = root
        for n in map(int, re.findall(r'/(\d+)', point)):
            if n % 2:
                break
            node = [x for x in node if isinstance(x.tag, str)][n // 2 - 1]
        for block, offset in offsets:
            if block is node or block in node.iterancestors() or node in block.iterancestors():
                return section, offset, '从 Anx 所在段落开始 · 侧栏进度单独保存'
        raise ValueError('无法匹配正文段落')
    except (ValueError, IndexError, KeyError):
        raise ValueError('暂时无法定位这本书的 Anx 阅读位置，请换一本书')


def read_view(request):
    library = books()
    if not library:
        raise ValueError('Anx 同步书库里还没有 EPUB 书籍')
    path = STATE_DIR / 'book-cursor.json'
    state = json.loads(path.read_text()) if path.exists() else {'bookId': library[0]['id'], 'revision': 0, 'cursors': {}}
    action = request.get('action', 'get')
    # A retry or a second device using an old view must not advance twice.
    fresh = request.get('revision') == state['revision']
    if action == 'select' and fresh:
        state['bookId'] = request['bookId']
    book = next((b for b in library if b['id'] == state['bookId']), None)
    if book is None:
        raise ValueError('这本书已不在 Anx 书库中')
    key = str(book['id'])
    z, spine = epub(book)
    with z:
        cursor = state['cursors'].get(key)
        if cursor is None or (action == 'sync' and fresh):
            section, offset, note = anx_cursor(book, z, spine)
            cursor = {'section': section, 'offset': offset, 'note': note}
        else:
            section, offset = cursor['section'], cursor['offset']
        def section_pages(n):
            return pages(chapter(z, spine[n])[1])
        ps = section_pages(section)
        # Align the initial Anx paragraph with a page boundary without dropping text.
        idx = next((i for i, (a, b, _) in enumerate(ps) if a <= offset < b), 0)
        if action in ('next', 'previous') and fresh:
            direction = 1 if action == 'next' else -1
            count = 4 if request.get('expanded') else 1
            history = cursor.setdefault('history', [])
            if direction < 0 and history:
                section, old_offset = history.pop()
                ps = section_pages(section)
                idx = next((i for i, (a, b, _) in enumerate(ps) if a <= old_offset < b), 0)
            else:
                if direction > 0:
                    history.append([section, offset])
                    del history[:-100]
                idx += direction * count
            while idx < 0 or idx >= len(ps):
                candidate = section + direction
                if not 0 <= candidate < len(spine):
                    idx = max(0, min(idx, len(ps) - 1))
                    break
                section = candidate
                ps = section_pages(section)
                idx = 0 if direction > 0 else max(0, len(ps) - count)
        # Skip image-only cover sections on the first open.
        while not ps and section + 1 < len(spine):
            section += 1
            ps = section_pages(section)
            idx = 0
        if not ps:
            raise ValueError('这一节没有可显示的文字')
        cursor.update(section=section, offset=ps[idx][0])
        state['cursors'][key] = cursor
        if action != 'get' and fresh:
            state['revision'] += 1
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2))
        tmp.replace(path)
        return {'bookId': book['id'], 'title': book['title'], 'text': ps[idx][2].strip(),
                'expandedText': ''.join(p[2] for p in ps[idx:idx + 4]).strip(),
                'expandedHasNext': section + 1 < len(spine) or idx + 4 < len(ps),
                'location': f'第 {section + 1}/{len(spine)} 节 · {idx + 1}/{len(ps)}',
                'note': cursor['note'], 'revision': state['revision'],
                'hasPrevious': section > 0 or idx > 0, 'hasNext': section + 1 < len(spine) or idx + 1 < len(ps),
                'books': [{'id': b['id'], 'title': b['title']} for b in library[:30]]}


def main():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    request = json.load(sys.stdin)
    with (STATE_DIR / 'book-cursor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            print(json.dumps(read_view(request), ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'error': str(e)}, ensure_ascii=False))
            sys.exit(1)

if __name__ == '__main__':
    main()
