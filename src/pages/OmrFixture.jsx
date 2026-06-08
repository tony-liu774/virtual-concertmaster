import { useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import fixtureXml from '../../tests/fixtures/simple-scale.musicxml?raw';

export default function OmrFixture() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    container.innerHTML = '';

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawComposer: false,
      drawingParameters: 'default',
    });

    osmd.Zoom = 2;
    osmd.load(fixtureXml)
      .then(() => {
        if (cancelled) return;
        container.innerHTML = '';
        osmd.render();
        document.body.dataset.omrFixtureReady = 'true';
      })
      .catch(err => {
        if (!cancelled) document.body.dataset.omrFixtureError = err.message;
      });

    return () => {
      cancelled = true;
      container.innerHTML = '';
      delete document.body.dataset.omrFixtureReady;
      delete document.body.dataset.omrFixtureError;
    };
  }, []);

  return (
    <main className="min-h-screen bg-white p-20">
      <div ref={containerRef} className="w-[2600px] bg-white" />
    </main>
  );
}
