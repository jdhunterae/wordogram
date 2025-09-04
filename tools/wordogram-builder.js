/*
  Wordogram Builder (v0.3)
  ------------------------
  Changes vs v0.2:
    - Tokenization now splits ONLY on whitespace; punctuation attached to a chunk stays attached
      • "DON'T" remains one chunk (apostrophe inside word)
      • "ghost-white" remains one chunk (hyphenated word)
      • An em dash between words like "done it— the" is attached to the left chunk ("it—")
    - Width calculations use the *visual* length of chunks (letters + in-chunk punctuation)
    - Lines are packed with a single inter-chunk space
    - Any non-letter, non-space character (digits, punctuation, symbols) is rendered as overlay cells (auto-filled, non-editable),
      and does NOT count toward row/column letter hints

  Usage:
    import { WordogramBuilder } from './wordogram-builder.js';
    const { buildPuzzle } = WordogramBuilder;
    const res = buildPuzzle("A STITCH IN TIME, SAVES NINE", { id: 'demo-phrase-001', minWidth:6, maxWidth:8 });
    console.log(res);

  JSON schema:
    {
      id: string,
      rows: number,
      cols: number,             // grid width W (letters + punctuation cells)
      solution: string[],       // length rows; each length cols; letters + spaces only
      overlay: [                // fixed, auto-filled characters (punctuation)
        { row: number, col: number, ch: string }
      ],
      meta?: { phrase?: string, author?: string, date?: string }
    }
*/

export const WordogramBuilder = (() => {
    // --- char helpers
    const isLetter = (ch) => /[A-Za-z]/.test(ch);
    // Common ASCII + Unicode punctuation used in quotes/phrases
    const isPunct = (ch) =>
        /[.,!?;:'"\-\u2013\u2014\u2018\u2019\u201C\u201D\u2026()\[\]{}]/.test(ch);

    // --- 1) Tokenize by *whitespace only*; keep punctuation inside the chunk
    function tokenize(phrase) {
        const rawChunks = String(phrase).split(/\s+/).filter(Boolean);
        return rawChunks.map(raw => {
            let out = '';
            for (const ch of raw) out += isLetter(ch) ? ch.toUpperCase() : ch;
            return { type: 'chunk', raw: out };
        });
    }

    // --- 2) Choose a width based on visual chunk lengths (letters + punctuation)
    function longestChunkLen(tokens) {
        return tokens.reduce((m, t) => Math.max(m, t.type === 'chunk' ? t.raw.length : 0), 0);
    }

    function chooseWidth(tokens, opts = {}) {
        const L = longestChunkLen(tokens);
        const minW = Math.max(opts.minWidth || L, L);
        const maxW = Math.max(opts.maxWidth || L, minW);
        let best = { W: minW, lines: Infinity, packed: null };
        for (let W = minW; W <= maxW; W++) {
            const packed = packLines(tokens, W);
            const lines = packed.length;
            if (lines < best.lines || (lines === best.lines && W < best.W)) {
                best = { W, lines, packed };
            }
        }
        return best; // {W, packed}
    }

    // --- 3) Pack lines with single-space separators between chunks
    function packLines(tokens, W) {
        const lines = [];
        let cur = []; let curLen = 0;
        const chunkLen = (t) => (t.type === 'chunk' ? t.raw.length : 0);
        for (const t of tokens) {
            if (t.type !== 'chunk') continue;
            const clen = chunkLen(t);
            const need = (curLen === 0 ? 0 : 1) + clen; // 1 for inter-chunk space
            if (curLen + need <= W) {
                if (curLen > 0) { cur.push({ type: 'space', size: 1 }); curLen += 1; }
                cur.push({ type: 'chunk', raw: t.raw }); curLen += clen;
            } else {
                lines.push(cur);
                cur = [{ type: 'chunk', raw: t.raw }]; curLen = clen;
            }
        }
        if (cur.length) lines.push(cur);
        return lines; // each line is a seq of {type:'chunk'|'space'}
    }

    // --- 4) Build a raw line string (letters + spaces + punctuation)
    function lineToString(line) {
        let s = '';
        for (const seg of line) {
            if (seg.type === 'space') s += ' ';
            else if (seg.type === 'chunk') s += seg.raw;
        }
        return s;
    }

    // --- 5) Split a raw string into letter cells and a punctuation overlay
    function placePunctuationAndLetters(raw, W) {
        const letters = [];
        const overlay = [];
        let col = 0;
        for (const ch of raw) {
            if (col >= W) break; // truncate if too long
            if (isLetter(ch)) {
                letters.push(ch.toUpperCase()); col++;
            } else if (ch === ' ') {
                letters.push(' '); col++;
            } else {
                // Any non-letter, non-space is overlay (digits, punctuation, symbols)
                overlay.push({ col, ch });
                letters.push(' '); col++;
            }
        }
        while (letters.length < W) letters.push(' ');
        return { letters: letters.join(''), overlay };
    }

    // --- 6) Greedy shift to maximize overlaps; optional pins for manual alignment
    function scoreShift(letters, shift, placed) {
        let score = 0;
        for (let c = 0; c < letters.length; c++) {
            const ch = letters[c];
            if (ch === ' ') continue;
            const col = shift + c;
            for (const row of placed) { if (row[col] === ch) score++; }
        }
        return score;
    }

    function shiftLinesToOverlap(lines, W, pins) {
        const rawStrings = lines.map(lineToString);
        const perRow = rawStrings.map(r => placePunctuationAndLetters(r, W));
        const shifts = new Array(lines.length).fill(0);

        // pins: [{ row, rawIndex, targetCol }]
        function applyPin(pin) {
            const { row, rawIndex, targetCol } = pin;
            if (row < 0 || row >= perRow.length) return;
            const raw = rawStrings[row];
            const index = Math.min(Math.max(rawIndex, 0), raw.length - 1);
            const visibleCol = index; // raw includes all visible cells (letters, spaces, punctuation)
            const maxShift = Math.max(0, W - perRow[row].letters.length);
            const shift = Math.max(0, Math.min(targetCol - visibleCol, maxShift));
            shifts[row] = shift;
        }

        for (const p of (pins || [])) applyPin(p);

        const placed = [];
        for (let r = 0; r < perRow.length; r++) {
            if (shifts[r] === 0 && (!pins || !pins.find(p => p.row === r))) {
                const letters = perRow[r].letters;
                const maxShift = Math.max(0, W - letters.length);
                let bestShift = 0, bestScore = -1;
                for (let s = 0; s <= maxShift; s++) {
                    const sc = scoreShift(letters, s, placed);
                    if (sc > bestScore) { bestScore = sc; bestShift = s; }
                }
                shifts[r] = bestShift;
            }
            const shifted = ' '.repeat(shifts[r]) + perRow[r].letters;
            placed.push(shifted.slice(0, W));
        }

        const solution = new Array(perRow.length).fill('');
        const overlay = [];
        for (let r = 0; r < perRow.length; r++) {
            const line = perRow[r].letters;
            const s = (' '.repeat(shifts[r]) + line).slice(0, W).padEnd(W, ' ');
            solution[r] = s;
            for (const o of perRow[r].overlay) {
                overlay.push({ row: r, col: Math.min(W - 1, shifts[r] + o.col), ch: o.ch });
            }
        }
        return { solution, overlay, shifts };
    }

    // --- 7) Build puzzle
    function buildPuzzle(phrase, opts = {}) {
        const id = opts.id || `wordogram-${Date.now()}`;
        const tokens = tokenize(phrase);
        const { W, packed } = chooseWidth(tokens, { minWidth: opts.minWidth, maxWidth: opts.maxWidth });
        const { solution, overlay, shifts } = shiftLinesToOverlap(packed, W, opts.pins);
        return {
            schema: '0.3',
            id,
            rows: solution.length,
            cols: W,
            solution,
            overlay,
            meta: { phrase, author: opts.author, date: new Date().toISOString() },
            ...(opts.debug ? { debug: { packed, shifts } } : {}),
        };
    }

    return { buildPuzzle, tokenize, packLines, chooseWidth };
})();
