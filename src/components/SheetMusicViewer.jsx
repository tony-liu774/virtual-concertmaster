import { useEffect, useRef, useCallback, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam } from 'vexflow';

// ── Layout constants ──────────────────────────────────────────────────────────
// Each measure gets a width proportional to note density AND accidental count.
// PX_PER_NOTE must be generous enough that VexFlow's formatter never has to
// squeeze notes together — symphonic scores with many sharps/flats need room.

const PX_PER_NOTE      = 42;   // horizontal px budgeted per note slot
const ACCIDENTAL_EXTRA = 18;   // extra px per note that carries a # or b modifier
const MIN_INNER_W      = 80;   // minimum notes-region (very sparse / whole-note measures)
const RIGHT_MARGIN     = 24;   // trailing gap after last note before the barline
const CANVAS_WRAP_W    = 1200; // px threshold before wrapping to the next staff line
const STAVE_X_PAD      = 16;   // left canvas margin (mirrored on right)
const STAVE_Y          = 55;   // top-of-staff Y for the first line
const LINE_HEIGHT      = 150;  // vertical gap between successive staff baselines
const STAVE_SPAN       = 40;   // 5 VexFlow staff lines × ~8 px

// Decoration padding at the left of a stave (reserves room before the first note):
//   col 0, line 0 : clef + key-sig + time-sig  → 96 px
//   col 0, line >0: clef glyph only            → 44 px
//   any other col : plain barline              → 14 px
function formatterPad(col, line) {
  if (col !== 0) return 14;
  return line === 0 ? 96 : 44;
}

/**
 * Count how many notes in a measure carry an accidental (# or b).
 * Each accidental needs ~18 px of extra horizontal clearance in VexFlow.
 */
function countAccidentals(measure) {
  return measure.filter(n =>
    n?.vexKey?.includes('#') || n?.vexKey?.match(/[a-g]b\//)
  ).length;
}

/**
 * Total pixel width budget for one stave.
 *
 *   budget = decorPad + max(noteCount×PX_PER_NOTE + accCount×ACCIDENTAL_EXTRA, MIN_INNER_W)
 *          + RIGHT_MARGIN + 4 (barline gap)
 *
 * Accidental detection is the key addition for dense scores: a D-major
 * passage where every note is C# or F# needs ~60 px/note, not 26.
 */
function computeStaveWidth(measure, col, line) {
  const nc      = measure.length;
  const acc     = countAccidentals(measure);
  const notesPx = Math.max(nc * PX_PER_NOTE + acc * ACCIDENTAL_EXTRA, MIN_INNER_W);
  return formatterPad(col, line) + notesPx + RIGHT_MARGIN + 4;
}

/**
 * Pack all measures into display lines.
 * Returns an array of lines, each line being an array of
 *   { mIdx, col, lineIdx, x, staveWidth }
 * All pixel positions are absolute (x from the left canvas edge).
 */
function packMeasuresIntoLines(measures) {
  const lines = [];
  let lineItems = [];
  let nextX = STAVE_X_PAD;

  measures.forEach((measure, mIdx) => {
    const col     = lineItems.length;
    const lineIdx = lines.length;
    const sw      = computeStaveWidth(measure, col, lineIdx);

    // Wrap to next line when the measure would overflow (never wrap the very
    // first measure on a line — that would produce an infinite loop for an
    // extremely dense measure that's wider than CANVAS_WRAP_W by itself).
    if (col > 0 && nextX + sw > CANVAS_WRAP_W) {
      lines.push(lineItems);
      const newLine = lines.length;
      const newSW   = computeStaveWidth(measure, 0, newLine);
      lineItems = [{ mIdx, col: 0, lineIdx: newLine, x: STAVE_X_PAD, staveWidth: newSW }];
      nextX = STAVE_X_PAD + newSW;
    } else {
      lineItems.push({ mIdx, col, lineIdx, x: nextX, staveWidth: sw });
      nextX += sw;
    }
  });

  if (lineItems.length) lines.push(lineItems);
  return lines;
}

/**
 * Renders a piece's measures as sheet music using VexFlow.
 *
 * Props:
 *   piece               – piece object (.measures, .clef, .keySignature, .timeSignature)
 *   currentNoteGlobal   – page-relative note index for the amber practice cursor
 *                         (pass null/undefined to hide the cursor)
 *   noteErrors          – Set<number> of page-relative indices that had pitch errors
 *   pitchFlash          – bool: true → practice cursor turns crimson (off-pitch)
 *   referenceNoteGlobal – page-relative note index for the "bouncing ball" reference
 *                         tracker (pass null/undefined when not in reference mode)
 *   className           – extra Tailwind classes on wrapper div
 *
 * Performance notes:
 *   renderSheet   – runs only when piece or noteErrors change (expensive VexFlow pass)
 *   updateOverlay – runs on any cursor/reference/pitch change (cheap SVG-only pass)
 *   This split avoids full VexFlow re-renders on every beat tick.
 */
export default function SheetMusicViewer({
  piece,
  currentNoteGlobal,
  noteErrors,
  pitchFlash          = false,
  referenceNoteGlobal = null,
  className           = '',
}) {
  const containerRef    = useRef(null);
  const notePositions   = useRef([]);    // [{ globalIdx, x, staveY }] — populated by renderSheet
  const overlayGroupRef = useRef(null);  // the <g class="vc-overlays"> SVG element

  // Render-error state: true if VexFlow throws during renderSheet.
  // Reset automatically whenever the piece changes so a corrected piece
  // clears the error without needing a page reload.
  const [renderError, setRenderError] = useState(false);
  useEffect(() => { setRenderError(false); }, [piece]);

  // ── Full VexFlow render ─────────────────────────────────────────────────────
  // Expensive: re-runs only when piece content or error paint changes.
  //
  // Layout strategy
  //   1. Compute per-measure stave widths (proportional to note count).
  //   2. Pack measures into lines using a greedy bin-pack limited to CANVAS_WRAP_W.
  //   3. Render each stave at its computed (x, y) with the correct decoration.
  //   4. Apply auto-beaming (VexFlow Beam.generateBeams) per measure so that
  //      16th notes group in clean beat-sized bundles rather than one chaotic
  //      blob per measure.
  const renderSheet = useCallback(() => {
    if (!containerRef.current || !piece) return;

    try {

    containerRef.current.innerHTML = '';
    notePositions.current   = [];
    overlayGroupRef.current = null;

    const clef          = piece.clef         || 'treble';
    const keySignature  = piece.keySignature  || 'C';
    const timeSignature = piece.timeSignature || '4/4';
    const measures      = piece.measures;

    // ── 1. Pack measures into lines ─────────────────────────────
    const lines = packMeasuresIntoLines(measures);

    // ── 2. Canvas sizing ────────────────────────────────────────
    // Width = widest line's right edge + right padding.
    const canvasWidth = Math.max(
      ...lines.map(items => {
        const last = items[items.length - 1];
        return last.x + last.staveWidth;
      })
    ) + STAVE_X_PAD;
    const canvasHeight = lines.length * LINE_HEIGHT + 50;

    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(canvasWidth, canvasHeight);
    const context = renderer.getContext();
    context.setFont('Palatino, serif', 10);
    context.setFillStyle('#c8cdd8');
    context.setStrokeStyle('#c8cdd8');

    let globalNoteIdx = 0;

    // ── 3. Render every measure ─────────────────────────────────
    for (const lineItems of lines) {
      for (const { mIdx, col, lineIdx, x, staveWidth } of lineItems) {
        const measure   = measures[mIdx];
        const y         = STAVE_Y + lineIdx * LINE_HEIGHT;
        const startIdx  = globalNoteIdx;

        // ── Stave ──────────────────────────────────────────────
        // The Stave constructor takes inner width = allocation − 4px barline gap.
        const stave = new Stave(x, y, staveWidth - 4);

        // Set the internal clef on EVERY stave without adding a visual glyph.
        // IMPORTANT: Do NOT use stave.setClef() — in this VexFlow build it
        // calls addClef() internally when no modifier exists, rendering a
        // duplicate glyph on every bar.  Direct property assignment is safe.
        stave.clef = clef;

        if (lineIdx === 0 && col === 0) {
          stave.addClef(clef);                               // ← visual glyph
          if (keySignature !== 'C') stave.addKeySignature(keySignature);
          stave.addTimeSignature(timeSignature);
        } else if (col === 0) {
          stave.addClef(clef);                               // ← visual glyph (line-start only)
        }
        // All other measures: clean barlines only

        stave.setContext(context).draw();

        // ── Notes + Voice + Formatter + Beaming (all guarded) ──
        // The entire per-measure block is wrapped so one bad note or
        // unsupported duration skips that measure without crashing the piece.
        try {
          // ── StaveNotes ────────────────────────────────────────
          const noteData = measure.map((note, j) => {
            const globalIdx = startIdx + j;
            const hasError  = noteErrors?.has(globalIdx);

            const sn = new StaveNote({
              keys:     [note.vexKey],
              duration: note.duration,
              clef,
            });

            // Explicit accidentals: the renderer adds sharps/flats per note
            // rather than relying on a key signature, so all accidentals are
            // always shown regardless of the key sig setting.
            if (note.vexKey.includes('#')) {
              sn.addModifier(new Accidental('#'), 0);
            } else if (note.vexKey.match(/[a-g]b\//)) {
              sn.addModifier(new Accidental('b'), 0);
            }

            // Past-error notes get a subtle crimson tint
            if (hasError) {
              sn.setStyle({ fillStyle: '#dc2626cc', strokeStyle: '#dc2626cc' });
            }

            return { sn, globalIdx };
          });

          // ── Voice ─────────────────────────────────────────────
          // totalBeats is computed from actual note durations so VexFlow's
          // Voice validator never rejects a measure whose beats don't exactly
          // match the time signature (e.g. an incomplete final bar).
          const beatMap = {
            wd: 6, w: 4, hd: 3, h: 2, qd: 1.5, q: 1,
            '8d': 0.75, '8': 0.5, '16': 0.25,
          };
          let totalBeats = 0;
          measure.forEach(note => { totalBeats += beatMap[note.duration] ?? 1; });

          const [numBeats, beatValue] = timeSignature.split('/').map(Number);
          const voice = new Voice({
            num_beats:  Math.max(totalBeats, numBeats),
            beat_value: beatValue || 4,
          })
            .setStrict(false)
            .addTickables(noteData.map(d => d.sn));

          // ── Formatter ─────────────────────────────────────────
          // Two-step process to prevent accidental/notehead collisions:
          //
          //  1. joinVoices + preCalculateMinTotalWidth lets VexFlow compute
          //     its own minimum safe width for this exact set of notes and
          //     accidentals — a hard lower bound that prevents any overlap.
          //
          //  2. We take the maximum of our generous estimate and VexFlow's
          //     minimum, adding a 12 px safety buffer.  The estimate is almost
          //     always larger (because we budget 42 + 18 px/accidental), but
          //     pathological passages (every note chromatically altered) can
          //     exceed it — this floor catches those cases automatically.
          const estimatedW = (staveWidth - 4) - formatterPad(col, lineIdx);
          const fmt = new Formatter().joinVoices([voice]);
          fmt.preCalculateMinTotalWidth([voice]);
          const vfMinW     = fmt.getMinTotalWidth();
          const formatInnerW = Math.max(estimatedW, vfMinW + 12);
          fmt.format([voice], formatInnerW);

          voice.draw(context, stave);

          // ── Beaming ───────────────────────────────────────────
          // Beam.generateBeams uses VexFlow's default grouping of Fraction(2,8)
          // = one quarter-note beat per beam group.  This breaks a measure of
          // 16 sixteenth notes into four clean groups of four, and a run of 8
          // eighth notes into four pairs — matching standard classical notation.
          // Quarter notes and longer are never beamed (VexFlow ignores them).
          const beams = Beam.generateBeams(noteData.map(d => d.sn));
          beams.forEach(beam => beam.setContext(context).draw());

          // ── Collect cursor anchor positions ───────────────────
          // Must happen AFTER draw() so getAbsoluteX() returns valid values.
          noteData.forEach(({ sn: sn_, globalIdx }) => {
            try {
              notePositions.current.push({
                globalIdx,
                x:      sn_.getAbsoluteX(),
                staveY: y,
              });
            } catch {
              // Position lookup can fail for malformed notes; omit the overlay anchor.
            }
          });
        } catch {
          // Silently skip malformed measures rather than crashing the full piece
        }

        globalNoteIdx += measure.length;
      }
    }

    // ── 4. Create the SVG overlay container ──────────────────────
    // updateOverlay will write cursor/ball elements inside this <g>.
    const svgEl = containerRef.current.querySelector('svg');
    if (svgEl) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'vc-overlays');
      svgEl.appendChild(g);
      overlayGroupRef.current = g;
    }

    } catch (err) {
      // Defensive outer catch — should never fire after data validation,
      // but prevents any future malformed piece from blanking the screen.
      console.error('[SheetMusicViewer] Sheet music rendering failed:', err);
      setRenderError(true);
    }
  }, [piece, noteErrors]);   // ← only VexFlow-relevant deps

  // ── Lightweight overlay update ──────────────────────────────────────────────
  // Cheap: only manipulates SVG overlay elements — no VexFlow re-render.
  // Runs whenever the cursor position, pitch state, or reference ball changes,
  // and also after renderSheet (because piece/noteErrors are in its deps so
  // the effects fire in declaration order: renderSheet first, then this).
  const updateOverlay = useCallback(() => {
    const g = overlayGroupRef.current;
    if (!g) return;

    g.innerHTML = '';   // clear previous overlay frame

    const positions = notePositions.current;
    if (positions.length === 0) return;

    const CURSOR_COLOR = pitchFlash ? '#dc2626' : '#c9a227';

    // ── Practice cursor (amber/crimson rectangle) ─────────────
    if (currentNoteGlobal != null) {
      const active = positions.find(p => p.globalIdx === currentNoteGlobal);
      if (active) {
        const nx = active.x;
        const ny = active.staveY;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x',      String(nx - 9));
        bg.setAttribute('y',      String(ny - 10));
        bg.setAttribute('width',  '24');
        bg.setAttribute('height', String(STAVE_SPAN + 30));
        bg.setAttribute('rx',     '4');
        bg.setAttribute('fill',   pitchFlash
          ? 'rgba(220, 38, 38, 0.12)'
          : 'rgba(201, 162, 39, 0.12)');
        bg.setAttribute('pointer-events', 'none');
        g.appendChild(bg);

        const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        border.setAttribute('x',            String(nx - 9));
        border.setAttribute('y',            String(ny - 10));
        border.setAttribute('width',        '24');
        border.setAttribute('height',       String(STAVE_SPAN + 30));
        border.setAttribute('rx',           '4');
        border.setAttribute('fill',         'none');
        border.setAttribute('stroke',       CURSOR_COLOR);
        border.setAttribute('stroke-width', '1.5');
        border.setAttribute('pointer-events', 'none');
        g.appendChild(border);
      }
    }

    // ── Reference "bouncing ball" (amber circle above staff) ──
    if (referenceNoteGlobal != null) {
      const refPos = positions.find(p => p.globalIdx === referenceNoteGlobal);
      if (refPos) {
        const cx = refPos.x + 3;          // slight horizontal centering offset
        const cy = refPos.staveY - 20;    // float above the top staff line

        // Glowing circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx',   String(cx));
        circle.setAttribute('cy',   String(cy));
        circle.setAttribute('r',    '6');
        circle.setAttribute('fill', '#c9a227');
        circle.setAttribute('pointer-events', 'none');
        // Hop animation — re-triggers on every note change because we
        // reconstruct the element from scratch on each updateOverlay call
        circle.setAttribute('style', [
          'animation: vc-ball-hop 0.22s ease-out;',
          'transform-box: fill-box;',
          'transform-origin: center;',
          'filter: drop-shadow(0 0 5px #c9a227) drop-shadow(0 0 10px #c9a22780);',
        ].join(' '));
        g.appendChild(circle);

        // Subtle "landing ring" that fades out below the ball
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ring.setAttribute('cx', String(cx));
        ring.setAttribute('cy', String(cy + 8));
        ring.setAttribute('rx', '8');
        ring.setAttribute('ry', '2');
        ring.setAttribute('fill',    'rgba(201,162,39,0.18)');
        ring.setAttribute('pointer-events', 'none');
        ring.setAttribute('style',
          'animation: vc-ring-fade 0.22s ease-out; transform-box: fill-box;'
        );
        g.appendChild(ring);
      }
    }
  }, [currentNoteGlobal, pitchFlash, referenceNoteGlobal]);
  // piece + noteErrors ensure updateOverlay fires after renderSheet when the
  // piece changes — React runs effects in declaration order in the same cycle.

  useEffect(() => { renderSheet();    }, [renderSheet]);
  useEffect(() => { updateOverlay();  }, [updateOverlay]);

  // ── Error fallback — clean message instead of blank screen ────
  if (renderError) {
    return (
      <div className={`rounded-xl flex items-center justify-center min-h-40 border border-feedback-error/20 bg-feedback-error/5 ${className}`}>
        <div className="text-center px-6 py-8">
          <p className="text-feedback-error font-body text-sm font-medium mb-1">
            Error loading score structure for this piece.
          </p>
          <p className="text-text-muted font-body text-xs">
            Please verify the notation data format.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`vf-dark rounded-xl overflow-auto ${className}`} style={{ background: 'transparent' }}>
      <style>{`
        /* ── Bouncing ball keyframes ───────────────────────── */
        @keyframes vc-ball-hop {
          0%   { transform: translateY(0)    scale(1);    }
          35%  { transform: translateY(-9px) scale(1.18); }
          70%  { transform: translateY(-2px) scale(0.96); }
          100% { transform: translateY(0)    scale(1);    }
        }
        @keyframes vc-ring-fade {
          0%   { opacity: 0.9; transform: scaleX(1);   }
          100% { opacity: 0;   transform: scaleX(1.8); }
        }

        /* ── Practice cursor glow ──────────────────────────── */
        .vf-stavenote path[fill="#c9a227"],
        .vf-stavenote path[stroke="#c9a227"] {
          filter: drop-shadow(0 0 6px #c9a227) drop-shadow(0 0 14px #c9a22780);
        }
        .vf-stavenote path[fill="#dc2626"],
        .vf-stavenote path[stroke="#dc2626"] {
          filter: drop-shadow(0 0 5px #dc2626) drop-shadow(0 0 12px #dc262660);
        }
        /* Past error notes — subtle red glow */
        .vf-stavenote path[fill="#dc2626cc"],
        .vf-stavenote path[stroke="#dc2626cc"] {
          filter: drop-shadow(0 0 3px #dc262680);
        }
      `}</style>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
