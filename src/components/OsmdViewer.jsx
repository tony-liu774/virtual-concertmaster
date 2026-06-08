/**
 * OsmdViewer — renders a MusicXML string using OpenSheetMusicDisplay (OSMD).
 *
 * Exposes a cursor-control API via React forwardRef so Practice.jsx can
 * synchronise the visual cursor with the pitch-detection tick loop:
 *
 *   osmdRef.current.cursorReset()  — move to beat 1 and show cursor
 *   osmdRef.current.cursorNext()   — advance one step (one beat position)
 *   osmdRef.current.cursorHide()   — hide cursor (session ended / paused)
 *   osmdRef.current.cursorShow()   — re-show cursor without moving it
 *
 * The OSMD cursor uses an amber (#f59e0b) highlight bar to match the app's
 * accent colour.  The container renders on a white background because OSMD's
 * SVG engine assumes a light canvas.
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const OsmdViewer = forwardRef(function OsmdViewer({ musicXml, className = '' }, ref) {
  const containerRef = useRef(null);
  const osmdRef      = useRef(null);   // holds the OSMD instance

  // ── Expose cursor API ──────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    cursorReset() {
      const cursor = osmdRef.current?.cursor;
      if (!cursor) return;
      cursor.reset();
      cursor.show();
    },
    cursorNext() {
      const cursor = osmdRef.current?.cursor;
      if (!cursor) return;
      // Guard: do not advance past the end of the score
      if (cursor.Iterator?.EndReached) return;
      cursor.next();
    },
    cursorHide() {
      osmdRef.current?.cursor?.hide();
    },
    cursorShow() {
      osmdRef.current?.cursor?.show();
    },
  }), []); // stable ref — no dependencies needed

  // ── Load & render whenever musicXml changes ────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !musicXml) return;

    let cancelled = false;
    container.innerHTML = ''; // clear any previous render artefacts

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize:   true,
      backend:      'svg',
      drawTitle:    true,
      drawComposer: true,
      followCursor: true,

      // Amber cursor bar to match the app's accent colour
      cursorsOptions: [
        { type: 0, color: '#f59e0b', alpha: 0.55 },
      ],
    });

    osmdRef.current = osmd;

    osmd.load(musicXml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        // Cursor must be initialised after render(); hide until session starts
        if (osmd.cursor) osmd.cursor.hide();
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[OsmdViewer] Failed to load MusicXML:', err);
        }
      });

    return () => {
      cancelled        = true;
      osmdRef.current  = null;
      container.innerHTML = '';
    };
  }, [musicXml]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        background:   '#ffffff',
        borderRadius: '12px',
        padding:      '20px 16px',
        overflowX:    'auto',
        minHeight:    120,
      }}
    />
  );
});

export default OsmdViewer;
