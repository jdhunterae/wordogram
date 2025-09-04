# Wordogram — Game & Puzzle Mechanics (Design Doc v1.3)

**Goal:** Ship a small, legible word-puzzle that’s easy to reason about and easy to port to Flutter. This document defines the UX, data, and rules.

---

## 1) Core Concept

A **letter-picross** built from a hidden phrase. Each **row** and **column** shows the **letters that appear in that line** (optionally with counts). Punctuation auto-fills and is not part of hints.

**Feedback model (no row/column glyphs):**

- **Hint letters** (in the row/column lists) are **muted** only when **all instances** of that letter in that line are correctly placed **and locked**. Otherwise they render normally.
- **Letter tiles** communicate state themselves:

  - **Locked** — confirmed correct (via Auto-check, Check, or Hint); input disabled; distinct locked style.
  - **Editable** — user can type; no verdict yet (when Auto-check is OFF) or until validated (when ON).
  - **Wrong** — red border when the letter is incorrect for that cell; clears when the letter is removed or corrected.
  - **Empty cells are never marked.**

**Primary loop**

1. Scan row/column hint letters.
2. Type letters into the grid.
3. Watch hint letters mute as a line’s letters are locked; tiles lock via Auto-check or Check.
4. Optionally use **Hint** to reveal and lock a letter.

---

## 2) Data Model (file schema v0.3)

```json
{
  "id": "string",
  "rows": 0,
  "cols": 0,
  "solution": ["..."], // letters + spaces only; each string length == cols
  "overlay": [
    // auto-filled, non-editable NON-LETTERS (digits, punctuation, symbols)
    { "row": 0, "col": 0, "ch": "," }
  ],
  "meta": { "phrase": "optional", "author": "optional", "date": "optional" },
  "schema": "0.3",
  "debug": "optional object (present only when builder opts.debug=true)"
}
```

### 2.1 Character Set & Normalization

- **Letters:** ASCII **A–Z only**. Builder uppercases input and treats only `[A-Za-z]` as letters.
- **Non-letters:** Any **non-letter, non-space** character (e.g., digits `0–9`, punctuation, symbols) is emitted as an `overlay` entry and occupies a visible cell in the grid.
- **Spaces:** Visible spaces are preserved (single space between chunks after packing).
- **Authoring note:** Quotes/phrases must be English without accents/diacritics. If such characters are present, they are treated as non-letters and would become overlay; avoid them when authoring.


Derived at runtime (not stored):

- `RowTargets[r] = Map<char, count>` from `solution[r]` (letters only).
- `ColTargets[c] = Map<char, count>` from column letters (ignore spaces/overlay).
- `OverlaySet = Set` of (row*cols+col) from `overlay`.


---

## 3) Grid & Cell Types

**Overlay cell**
Fixed non-letter (digits, punctuation, symbols) from `overlay[]`. Non-interactive. Excluded from hints and validation. Always rendered.

**Tile cell (non-overlay)**
An interactive cell that may target either a **letter** _or_ a **space** in the solution. Users can type in **any** non-overlay tile.

**Sub-states**

- **Editable — empty**: no character typed.
- **Editable — typed**: a letter (A–Z) is present; still editable until validated/locked.
- **Locked — correct letter**: confirmed match (via Auto-check, Check, or Hint). Input disabled; distinct locked style. Hint-placed letters use a distinct **hint color**.
- **Locked — space**: solution is a space. During play it stays editable/empty and is **never marked** by itself. It locks (muted “gutter” style) **only when its row or column is complete** or after a **Check** that completes that line.
- **Marked — wrong**: red border when the typed letter is incorrect for that cell. The border clears when the letter is removed or corrected. **Empty tiles are never marked.**

**Typing rules**

- Accept only letters **A–Z**; input is uppercased. Backspace clears the cell.
- If the solution at this tile is a **space**: any typed letter is **wrong** whenever validation is active (Auto-check ON, or during a Check). Leaving it empty is neutral and never marked.

**Typing feedback (controlled by Auto-check)**

- **Auto-check OFF** → no per-keystroke validation; tiles validate/lock only on **Check**.
- **Auto-check ON** → immediate validation: correct letters lock as you type; wrong letters show a red border that clears on erase. Space targets never lock on type; they lock only via **line completion** or **Check**.

---

## 4) Hints UI

### 4.1 Layout (no wrapping, no internal scroll)

- **Row hints**: render as a **single horizontal line** to the left of each grid row. **Never wraps.** If content would overflow, the **hint area expands horizontally**; the overall page/grid may scroll.
- **Column hints**: render as a **single vertical stack** above each grid column. **Never wraps.** If content would overflow, the **hint area expands vertically**; the overall page/grid may scroll.
- Hint areas do **not** use internal scrollbars or fades; they expand to fit content and never bleed into neighboring tiles. Hint tile dimensions are tied to the grid cell size; placement aligns with the grid.

### 4.2 What hints show (letters only; optional counts)

There are **no chips and no glyphs** (no ✓/✕/!). Hints are just **letters** (A–Z), optionally with a small **superscript** number.

- **Counts disabled**

  - **Normal**: show each distinct letter that appears in that line.
  - **Completed**: **mute** a letter when **all instances** of that letter in the line have been **locked**. (No number is shown.)

- **Counts enabled**

  - **Normal**: show each distinct letter with a `sup` of how many are **left to be found** in that line:
    `Left(letter) = TargetCount(letter in line) − LockedCount(letter in line)`
    `LockedCount` counts **only locked-correct** tiles (Auto-check, Check, Hint). Typed-but-not-validated letters do **not** reduce `Left`.
  - **Completed**: **mute** the letter and show `sup 0` when **all instances** are locked.

> A letter is muted **only** when its **LockedCount** meets the target. Merely typing a letter (not yet validated/locked) never mutes it or reduces `Left`.

### 4.3 When hint states update

Hint visuals update **only** on validation events:

- Auto-check **ON**: immediately after a keystroke locks a correct letter.
- **Check** button: after processing (locking correct tiles and marking wrong ones).
- **Hint** button: immediately after a hint fills and locks a letter.
- **Clear / Reset**: recompute from scratch (everything returns to unmuted with full `Left` counts).

### 4.4 Calculation details & edge cases

- Targets per line are derived from `solution` **letters only** (ignore spaces and overlay).
- Locked counts per line count **only locked-correct** tiles (includes hint-placed letters).
- Over-typed extra instances of a letter in wrong positions are **not** locked and do **not** reduce `Left`.
- Muting is **per-line**: a letter may be muted in one row/column and normal in another.

### 4.5 Hint letter ordering

To avoid revealing word order, **do not** preserve first-occurrence order. The ordering is configurable:

- **Default:** alphabetical **A→Z** (stable).
- **Optional modes:** **vowels-first** (A,E,I,O,U then B→Z), or a **deterministic shuffle** seeded by the puzzle ID (so all players see the same order for a given puzzle).

---

## 5) Mechanics & Algorithms

### 5.1 Targets & locked counts

For a line `L` (row or column):

- `Target[L][ch]` = number of times letter `ch` appears in `solution` for that line (letters only).
- `Locked[L][ch]` = number of **locked-correct** tiles in that line whose letter is `ch`.
- `Left[L][ch] = max(Target[L][ch] − Locked[L][ch], 0)`.

Hint visuals depend only on **Locked** (not on typed letters).

### 5.2 Validation model

**Auto-check OFF (manual):**

- Typing does **not** validate.
- On **Check**:

  - If a typed letter equals `solution[r][c]` → **lock** that tile.
  - If a typed letter does **not** equal `solution[r][c]` → **mark red** (incorrect).
  - **Empty tiles are not marked** (no green/red).

**Auto-check ON (immediate):**

- On each keystroke in a non-locked, non-overlay tile:

  - If empty → clear any red border.
  - If typed letter == `solution[r][c]` → **lock** immediately.
  - Else → **mark red**; removing the letter clears the red border.

- Locked tiles ignore further input.

**Space targets:** If `solution[r][c]` is a **space**, any typed letter is **wrong** when validation is active (red border in Auto-check; marked red on Check). Leaving it empty is neutral and never marked.

**Navigation & backspace with locks (both modes):**

- Locked tiles are **read-only** until **Clear/Reset**.
- Backspace and arrow navigation **skip over locked tiles** to the nearest previous/next editable tile; if none exists, the caret stays on the nearest editable.
- Validation is synchronous; if UI throttling is used, apply keystrokes after prior validation completes (avoid “type then instant erase” glitches).

### 5.3 Locking rules

A tile becomes **locked** when:

- it’s validated correct by **Auto-check** or **Check**, or
- it’s filled by **Hint** (uses a distinct hint text color).

Locked tiles are read-only; overlay punctuation is always locked.

### 5.4 Hint button

- Consumes one hint.
- Chooses a random unsolved **letter tile** and inserts the correct letter.
- The letter is **locked** immediately and styled with a distinct **hint color**.

### 5.5 Line completion locking (spaces)

- A **row** is _complete_ when **every letter tile** in that row is **locked-correct** (ignore spaces/overlay). When complete, **lock all space tiles** in that row with a muted “gutter” style.
- A **column** is _complete_ when **every letter tile** in that column is **locked-correct**. When complete, **lock all space tiles** in that column.
- If a space tile is already locked (from a prior row/column completion), **leave it locked**; re-lock operations are no-ops.

---

## 6) Controls & Options

- **Check**: runs full validation per §5.2 (according to current Auto-check setting). Locks only correct letters; marks incorrect letters red; leaves empty cells unmarked.
- **Clear**: clears all letter inputs and cell markings; overlay remains. Also resets **session stats** and **hint budget**.
- **Hint**: see §5.4.

### 6.1 Toggles (config)

- **Show letter counts** _(default: OFF)_ — shows a superscript **Left** count on **hint letters** in each line.
- **Auto-check** _(default: OFF)_ — toggles the per-keystroke validation model in §5.2.

### 6.2 Hints budget

- Default **3** hints per puzzle.
- Budget **resets** on **Clear** and when loading a **new puzzle**.

---

## 7) Visual & Accessibility

- Cell size = CSS var `--cell-size` (default 56px); hint areas align to grid; hint tiles computed from it.
- Minimum touch targets ≥ 48dp; keyboard nav with arrows; visible focus ring.
- High-contrast; **hint letters** use muted styling/opacity for “completed”; **tiles** use border/lock styles (not color alone).

---

## 8) Persistence

- **Grid state** key: `wordogram:<puzzleId>` → `{ values[], hintsLeft }`.

- **Session statistics** key (per-game): `wordogram:<puzzleId>:stats:session`

- **Overall statistics** key (cumulative across clears): `wordogram:<puzzleId>:stats:overall`

```json
{
  "hintsUsed": 0,
  "incorrectLetters": 0, // increment on EVERY wrong input event or wrong mark
  "attempts": 0, // Auto-check OFF: +1 per Check; Auto-check ON: incorrectLetters + 1 (on completion)
  "usedAutoCheck": false,
  "usedLetterCounts": false
}
```

**Stats update rules**

- Increment `hintsUsed` on each **Hint**.
- Increment `incorrectLetters` **every time** a wrong mark is produced (each invalid keystroke in Auto-check; each wrong cell on Check).
- Increment `attempts` on each **Check** (Auto-check OFF).
  Auto-check ON: set `attempts = incorrectLetters + 1` **when the puzzle is completed**.
- **Clear** resets **session stats** (to 0) and the hint budget, but **does not** touch **overall** stats.
  Loading a **new puzzle** resets session stats and hint budget.

---

## 9) Builder (phrase → puzzle)

- **Split policy:** split on **whitespace only**; keep in-chunk punctuation (e.g., `"DON'T"`, `"ghost-white"`, `"it—"`).
- **Visual width:** a chunk’s width equals its visible characters (letters + in-chunk punctuation).
- **Overlay:** in-chunk punctuation becomes `overlay` entries at their visual columns; letters occupy the `solution` string; spaces between chunks are single visible spaces.
- **Width selection:** choose `W ∈ [minWidth..maxWidth]` to minimize number of lines; tie-break smaller `W`.
- **Line packing:** single inter-chunk spaces; greedy line breaks by `W`.
- **Overlap shifting:** greedily shift lines horizontally (within `W`) to maximize letter overlaps; optional pins `{ row, rawIndex, targetCol }` in visible-cell coordinates.

**Pins example:** For the raw string `"BAKER."` at `row 0` with `W=10`, if you want the period to end at column 9, specify a pin `{ row: 0, rawIndex: 5, targetCol: 9 }`. (Indices are zero-based; `rawIndex` is within the raw visual string that includes letters, spaces, and overlay characters.)

---

## 10) Acceptance Criteria

1. **Overlay correctness:** non-letters (digits, punctuation, symbols) auto-fill in correct cells; excluded from all counts.
2. **Hints behavior:** letters mute **only** when all instances in that line are **locked**; with counts enabled, superscript shows **Left** (0 when complete). Updates occur **only** on validation events (Auto-check locks, Check, Hint, Clear/Reset).
3. **Validation behavior:**

   - Auto-check OFF: **Check** locks only correct letters; marks only incorrect letters; leaves empty cells unmarked.
   - Auto-check ON: keystrokes immediately lock correct letters or mark red on mismatch; red clears when the input is emptied.

4. **Hint button:** inserts a correct letter, **locks** it, and applies distinct **hint color**.
5. **Row/Column completion:** when a line is complete, its **space cells lock** with a muted gutter style.
6. **Layout:** row hints are **single-line** horizontal lists; column hints are **single-column** vertical stacks; hint areas **expand** (no internal wrapping/scroll); tiles align to `--cell-size` and never overflow neighbors.
7. **Statistics** persist and match the rules in §8.

---

## 11) Implementation Plan (Refactor)

**Phase A — logic split**

- `logic/targets.js` → build RowTargets/ColTargets.
- `logic/evaluate.js` → `validateCell`, `checkPuzzle`, line completion checks.
- `logic/hints.js` → derive **Locked/Left** per line + muting rules + ordering (A→Z / vowels-first / deterministic shuffle).

**Phase B — UI split**

- `ui/grid.js` → renderGrid, input handlers, locking helpers, nav/backspace skipping locks.
- `ui/hints.js` → render row/column hint areas (no wrap, expand).
- `ui/stats.js` → track & persist session/overall stats.
- `state/persist.js` → load/save grid + stats.
- `app.js` → glue + controls.

**Phase C — styling**

- Define `--cell-size`; compute hint tile dims from it.
- Hint-letter sizes: 11px text, 9px superscripts; hint tiles min-height 32–36px.

---

## 12) Open Questions (minor)

- **Non-ASCII letters:** keep A–Z only, or normalize accents (é→E) for imported phrases? (If needed, specify normalization in §9 and the builder.)
- **Overlap tie-breaks:** if two shifts score equally, prefer **smaller shift** (left-bias) for compactness? (Default: yes.)
- **Deterministic hint order seed:** confirm seed = puzzle `id` string hash (so web/Flutter render same order for a given mode).

---

## 13) Pseudocode Snippets

**Derive per-line targets**

```
deriveTargets(solution):
  RowTargets[r] = countLetters(solution[r])
  ColTargets[c] = countLetters( columnString(solution, c) )
  return { RowTargets, ColTargets }
```

**Derive remaining counts for hints**

```
deriveLeft(axis, index, Locked, Targets):
  T = Targets[axis][index]            // Map<char, targetCount>
  L = Locked[axis][index]             // Map<char, lockedCount>
  Left = {}
  for each ch in T:
    Left[ch] = max(T[ch] - (L[ch] || 0), 0)
  return Left
// UI: counts OFF -> mute letter if Left[ch]==0
//     counts ON  -> show ch with sup Left[ch]; mute when Left[ch]==0
```

**Validate a single cell**

```
validateCell(r, c, typed, solution, mode):
  if overlay(r,c): return 'overlay' // already locked by design
  if solution[r][c] == ' ':
    if mode == 'auto' and typed != '': markWrong(r,c)
    return
  if mode == 'auto':
    if typed == solution[r][c]: lock(r,c)
    else if typed != '': markWrong(r,c)
    else clearMark(r,c)
  // manual mode defers to checkPuzzle()
```

**Check the whole puzzle (manual)**

```
checkPuzzle(grid, solution):
  wrong = 0
  for each non-overlay cell (r,c):
    typed = grid[r][c]
    if typed == solution[r][c]: lock(r,c)
    else if typed != '': markWrong(r,c), wrong++
    else /* empty */ // not marked
  return wrong
```

**On Hint**

```
onHint():
  pick random unsolved letter cell (r,c)
  set grid[r][c] = solution[r][c]
  lock(r,c)
  stats.hintsUsed++
```

**On Line Completed (lock spaces)**

```
onLineCompleted(axis, index):
  if every letter tile in the line is locked-correct:
    for each space cell in the line:
      if not already locked: lockSpace(r,c)
```

**Hint letter ordering**

```
orderHintLetters(letters, mode, seed):
  if mode == 'AZ': return sortAZ(letters)
  if mode == 'VOWELS_FIRST': return vowelsFirstAZ(letters)
  if mode == 'DETERMINISTIC_SHUFFLE': return shuffleDeterministic(letters, seed)
```

---

## 14) Done = Ready to Code

When this v1.3 is signed off, refactor the web prototype per §§11–13, then mirror the logic in Flutter with unit tests for hint updates, validation modes, stats, and ordering.

---

## Addendum: v0.3 Spec Clarifications (Authoritative)

> This section **supersedes any conflicting phrasing earlier in the doc** and is intended to remove ambiguity for v0.3.

### A. Character Set, Normalization, and Escaping

- **Letters:** ASCII **A–Z only**. The builder uppercases input and treats only `[A-Za-z]` as letters.
- **Non-letters:** **Any** non-letter, non-space character (e.g., digits `0–9`, punctuation, symbols, curly quotes, em/en dashes) is emitted as an **overlay** entry and occupies a visible grid cell.
- **Spaces:** Visible spaces are preserved. The builder normalizes author input to **single spaces** between chunks, trimming leading/trailing whitespace and converting tabs/newlines to spaces.
- **HTML-safety:** Overlay characters are rendered with HTML-escaping for `&`, `<`, `>`, `"`, and `'` to prevent injection. Letters and spaces are safe by construction.

### B. Data Model (v0.3) — Field Semantics

- **Top-level schema:** `"schema": "0.3"` is required.
- **Meta:** `meta: { phrase?: string, author?: string, date?: string }`.
- **Overlay entries:** `{ row, col, ch }` where `row`/`col` are 0-indexed visible coordinates and `ch` is a single-character string. (UI must escape when rendering.)
- **Optional/unknown fields:** Clients **MUST ignore** unknown top-level fields (e.g., `debug`) for forward compatibility.
- **IDs and spoilers:** `id` must be a **non-reversible** identifier (e.g., salted hash) to avoid leaking the solution from predictable filenames. Solutions are client-visible by design—**no security guarantees**.

### C. Builder Algorithm (Deterministic)

- **Tokenization:** Split the input phrase on whitespace only. Keep in-chunk punctuation/symbols (which become overlay). Examples:
  - `DON'T STOP` → chunks: `DON'T`, `STOP`
  - `ghost-white` → single chunk (overlay `-` in-grid)
  - `He lived at 123 Baker Street.` → overlay for `1`, `2`, `3`, and `.`
- **Greedy packing by width:** Search widths within `minWidth..maxWidth` (default **14..24**). Primary objective: **minimize rows**. Tie-breakers: (1) **smaller width**, (2) **smaller total shift**.
- **Overlap shifting:** For each next line, attempt shifts `0..W-1` and pick the smallest shift that never mismatches locked letters from previous lines. Spaces/overlay cells do **not** block overlap. Cost = sum of chosen shifts across lines; pick minimal cost; tie-break by smaller first conflicting shift.
- **Pins:** Pin coordinates are **visible column indices**. Pins are applied **before** overlap shifting on that line. If a pin makes a placement impossible, the builder must emit a readable error (`PIN_CONFLICT` with context) and abort.
- **Determinism:** With the same `(phrase, options)`, the builder output is deterministic. Any future randomness must be **seedable** via options.

### D. Hints & Validation (Player Experience)

- **Letter hints:** Display letters **A→Z** only; omit zero-count entries. Counts exclude spaces and overlay.
- **Hint budget (default):** `3` per puzzle (suggested). Revealed hints **lock** those letters in-place and updates hint bars immediately.
- **Auto-check:**
  - **OFF:** The grid only validates on user action (**Check**). Correct letters lock; incorrect letters mark. Lines lock spaces on completion.
  - **ON:** Correct letters lock immediately on entry; wrong letters mark immediately; spaces lock on line completion or **Check**.
- **Locking & clearing:** Locked cells are immutable. Provide **Clear Line** and **Clear Puzzle** actions; define that **Clear** removes user letters and marks but not overlay.

### E. Input, Navigation, and Accessibility

- **Typing constraints:** Accept only A–Z (mapped to uppercase) for editable cells. Ignore other printable keys except navigation/edit commands.
- **Keyboard navigation:** Arrow keys jump across **editable** cells only (skip overlay/space). Backspace deletes then moves left to the previous editable cell.
- **Mobile UX:** Disable autocorrect, predictive text, and smart quotes on the text input. Tap focus should never land on overlay cells.
- **A11y:** Non-color cues (icons/borders) for locked/marked states; ARIA labels per tile (e.g., `row 2, col 5, locked letter A`); high-contrast mode toggle.

### F. Presentation & Layout

- **Hint bars:** Never wrap. On narrow viewports, allow horizontal scroll (or truncate with affordance). Specify maximum hint bar width before overflow handling kicks in.
- **Responsive metrics:** Define min tile size (e.g., **36px**), min touch target (**44×44px**), and scaling rules for small screens. Maintain consistent line-height for readability.

### G. Publishing & Operations (GitHub Pages)

- **Distribution:** Either a dated path (e.g., `puzzles/2025-09-04.json`) or an index file `puzzles/index.json` with items `{ id, path, date }[]`.
- **Local persistence:**
  - Settings: `localStorage["wg:v1:settings"] = { autoCheck: boolean, theme?: "auto"|"light"|"dark" }`
  - Per-puzzle state: `localStorage["wg:v1:puzzle:<id>"] = { grid: string[], locks: string[], hintsUsed: number, solvedAt?: ISO }`
- **“% solved” banner:** Global stats require a backend. For v0.3 on Pages, prefer **local-only** phrasing (“Your solve streak”). If adding analytics later, include a toggle and a short privacy blurb.
- **Privacy:** No tracking beyond local storage for v0.3.

### H. QA, Guardrails, and Edge Cases

- **Size limits:** Builder enforces `cols ≤ 30`, `rows ≤ 12`, and `phrase length ≤ 180` (configurable). Clear error messages on violation.
- **Unicode hygiene:** Normalize input whitespace; preserve non-ASCII punctuation as overlay but **escape on render**.
- **Golden tests:** Ship sample fixtures with expected `solution`/`overlay` and a few pin scenarios. Include a tiny test page to visualize outputs.
- **Error taxonomy:** Reserve codes like `PIN_CONFLICT`, `WIDTH_UNFITTABLE`, `PHRASE_TOO_LONG`, `SCHEMA_UNSUPPORTED` for predictable handling.

### I. Type Definitions (Authoritative for v0.3)

```ts
// Overlay entry coordinates are 0-indexed visible positions.
export type OverlayEntry = { row: number; col: number; ch: string };

export interface WordogramPuzzle {
  schema: "0.3";
  id: string;
  rows: number;
  cols: number;
  solution: string[]; // length === rows; each string length === cols
  overlay: OverlayEntry[];
  meta?: { phrase?: string; author?: string; date?: string };
  debug?: Record<string, unknown>; // optional; clients should ignore
  [k: string]: unknown; // forward-compatible
}
```

_(Optional JSON Schema can be added later; TS types above are the source of truth for v0.3.)_
