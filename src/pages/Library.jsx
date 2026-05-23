import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import {
  AlertCircle, CheckCircle2, ChevronRight, Cpu, ExternalLink, FileMusic,
  Layers, Loader2, Music2, ScanLine, Search, Smartphone, Upload, X,
} from 'lucide-react';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { PIECES_LIST } from '../utils/samplePieces.js';
import { parseMusicXml } from '../utils/musicXmlParser.js';
import { checkServerHealth, scanSheetMusicImage } from '../utils/omrClient.js';
import { evaluateScanQuality, isOmrScannedPiece } from '../utils/scanQuality.js';
import OsmdViewer from '../components/OsmdViewer.jsx';

const INSTRUMENT_FILTERS = ['All', 'Violin', 'Viola', 'Cello', 'Double Bass'];

const INSTR_LABEL = {
  violin: 'Violin',
  viola: 'Viola',
  cello: 'Cello',
  bass: 'Double Bass',
};

const LS_UPLOADS = 'virtual_concertmaster_uploads';
const CLEF_OPTIONS = ['treble', 'alto', 'bass'];
const PLAYSCORE_URL = 'https://www.playscore.co/';

const QUALITY_BADGE = {
  pass: 'border-feedback-success/40 text-feedback-success bg-feedback-success/10',
  review: 'border-accent-amber/40 text-accent-amber bg-accent-amber/10',
  fail: 'border-feedback-error/40 text-feedback-error bg-feedback-error/10',
};

const DIFFICULTY_COLOR = {
  Beginner: 'text-feedback-success border-feedback-success/30 bg-feedback-success/5',
  Intermediate: 'text-accent-amber border-accent-amber/30 bg-accent-amber/5',
  Advanced: 'text-feedback-error border-feedback-error/30 bg-feedback-error/5',
  Imported: 'text-accent-amber border-accent-amber/30 bg-accent-amber/5',
};

const ENGINE_LABEL = {
  audiveris: 'Audiveris',
  oemer: 'Oemer',
  remote: 'Remote OMR',
};

function engineLabel(engine = '') {
  return ENGINE_LABEL[engine] ?? engine;
}

function scanSeconds(scanMeta) {
  const elapsedMs = scanMeta?.elapsedMs;
  if (!elapsedMs) return '';
  return `${(elapsedMs / 1000).toFixed(elapsedMs >= 10_000 ? 0 : 1)}s`;
}

function loadSavedUploads() {
  try { return JSON.parse(localStorage.getItem(LS_UPLOADS) || '[]'); }
  catch { return []; }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const [header, data] = e.target.result.split(',');
      resolve({
        base64: data,
        mediaType: header.replace('data:', '').replace(';base64', ''),
      });
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

function parseMxlRootPath(containerXml) {
  if (!containerXml) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(containerXml, 'application/xml');
  return doc.querySelector('rootfile')?.getAttribute('full-path') ?? '';
}

async function readMusicXmlFromFile(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.mxl')) return readFileAsText(file);

  const buffer = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buffer);
  const container = zip.file('META-INF/container.xml');
  const rootPath = container ? parseMxlRootPath(await container.async('text')) : '';
  const normalizedRootPath = rootPath.replace(/^\/+/, '');
  const xmlFile = (normalizedRootPath && zip.file(normalizedRootPath)) ||
    Object.values(zip.files).find(entry =>
      !entry.dir &&
      /\.(musicxml|xml)$/i.test(entry.name) &&
      !/META-INF\/container\.xml$/i.test(entry.name),
    );

  if (!xmlFile) throw new Error('The compressed MusicXML file did not contain a readable score.');
  return xmlFile.async('text');
}

function addRuntimeQuality(piece, instrument) {
  if (!isOmrScannedPiece(piece)) return piece;
  const scanQuality = evaluateScanQuality(piece, { expectedInstrument: instrument });
  return {
    ...piece,
    scanQuality,
    scanBlocked: scanQuality.status === 'fail',
  };
}

export default function Library() {
  const navigate = useNavigate();
  const { instrument } = useInstrumentStore();
  const [query, setQuery] = useState('');
  const [filterInstr, setFilterInstr] = useState('All');
  const xmlInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [serverHealth, setServerHealth] = useState(null);
  const [uploadState, setUploadState] = useState('idle');
  const [uploadFile, setUploadFile] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [pendingScan, setPendingScan] = useState(null);
  const [reviewEdits, setReviewEdits] = useState({ title: '', composer: '', clef: 'treble', bpm: 80 });
  const [uploadedSongs, setUploadedSongs] = useState(loadSavedUploads);
  const [showPlayScoreGuide, setShowPlayScoreGuide] = useState(false);
  const xmlImportSourceRef = useRef('direct-import');

  const checkedUploads = useMemo(
    () => uploadedSongs.map(piece => addRuntimeQuality(piece, instrument)),
    [instrument, uploadedSongs],
  );
  const allSongs = useMemo(() => [...checkedUploads, ...PIECES_LIST], [checkedUploads]);
  const filteredSongs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allSongs.filter(piece => {
      const matchInstr =
        filterInstr === 'All' ||
        piece.instrument === 'all' ||
        piece.instrument?.toLowerCase() === filterInstr.toLowerCase();
      const matchQuery =
        !normalizedQuery ||
        piece.title.toLowerCase().includes(normalizedQuery) ||
        piece.composer?.toLowerCase().includes(normalizedQuery);
      return matchInstr && matchQuery;
    });
  }, [allSongs, filterInstr, query]);

  useEffect(() => {
    checkServerHealth().then(setServerHealth);
  }, []);

  useEffect(() => () => {
    if (pendingScan?.imageUrl) URL.revokeObjectURL(pendingScan.imageUrl);
  }, [pendingScan?.imageUrl]);

  function persistPiece(piece) {
    const saved = loadSavedUploads();
    const next = [piece, ...saved.filter(p => p.id !== piece.id)];
    localStorage.setItem(LS_UPLOADS, JSON.stringify(next));
    setUploadedSongs(next);
  }

  function practicePiece(piece) {
    if (piece.scanBlocked) {
      setUploadState('error');
      setUploadMessage('That scan failed quality checks, so Practice is blocked. Use MusicXML or rescan with a cleaner/cropped page.');
      return;
    }
    sessionStorage.setItem('selectedPiece', piece.id);
    navigate('/practice', { state: { pieceId: piece.id } });
  }

  function chooseXmlFile(source = 'direct-import') {
    xmlImportSourceRef.current = source;
    setShowPlayScoreGuide(false);
    setUploadState('idle');
    setUploadMessage('');
    xmlInputRef.current?.click();
  }

  async function handleXmlImport(file, source = 'direct-import') {
    setUploadState('reading');
    setPendingScan(null);
    const importedFromPlayScore = source === 'playscore';

    if (file.size > 20 * 1024 * 1024) {
      setUploadState('error');
      setUploadMessage('File is too large. Use a MusicXML file under 20 MB.');
      return;
    }

    let xmlText;
    try { xmlText = await readMusicXmlFromFile(file); }
    catch {
      setUploadState('error');
      setUploadMessage('Could not read that MusicXML file.');
      return;
    }

    const trimmed = xmlText.trimStart();
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<score-')) {
      setUploadState('error');
      setUploadMessage('This does not look like MusicXML. Upload .musicxml, .xml, or compressed .mxl.');
      return;
    }

    const parsed = parseMusicXml(xmlText, 80);
    const titleFallback = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const piece = {
      id: `upload_${Date.now()}`,
      title: (parsed.title && parsed.title !== 'Untitled') ? parsed.title : titleFallback,
      composer: parsed.composer || 'Unknown',
      clef: parsed.clef || 'treble',
      keySignature: parsed.keySignature || 'C',
      timeSignature: parsed.timeSignature || '4/4',
      bpm: parsed.bpm || 80,
      instrument: 'all',
      difficulty: 'Beginner',
      isUploaded: true,
      uploadedAt: new Date().toISOString(),
      scannedBy: importedFromPlayScore ? 'playscore-musicxml' : 'direct-import',
      importSource: importedFromPlayScore ? 'PlayScore 2' : 'MusicXML',
      musicXmlString: xmlText,
      measures: parsed.measures,
    };

    persistPiece(piece);
    setUploadState('success');
    setUploadMessage(`"${piece.title}" imported${importedFromPlayScore ? ' from PlayScore 2' : ''}. It is now in your library.`);
  }

  async function handleImageScan(file) {
    setPendingScan(null);
    const health = await checkServerHealth();
    setServerHealth(health);

    if (!health.ok) {
      setUploadState('error');
      setUploadMessage('OMR server is not running. Start it with npm run dev:api, then scan again.');
      return;
    }
    if (!health.anyAvailable) {
      setUploadState('error');
      setUploadMessage('The OMR server is running, but no scanner engine is installed.');
      return;
    }
    if (file.size > 14 * 1024 * 1024) {
      setUploadState('error');
      setUploadMessage('Image too large. Use a smaller or cropped photo under 14 MB.');
      return;
    }

    setUploadState('scanning');
    let base64, mediaType;
    try { ({ base64, mediaType } = await readFileAsBase64(file)); }
    catch {
      setUploadState('error');
      setUploadMessage('Could not read that image.');
      return;
    }

    const result = await scanSheetMusicImage({ base64, mediaType, filename: file.name });
    if (!result.success) {
      setUploadState('error');
      setUploadMessage(result.error ?? 'OMR scan failed.');
      return;
    }

    const { piece } = result;
    const quality = evaluateScanQuality(piece, { expectedInstrument: instrument });
    const imageUrl = URL.createObjectURL(file);
    setReviewEdits({
      title: piece.title,
      composer: piece.composer,
      clef: piece.clef,
      bpm: piece.bpm,
    });
    setPendingScan({ piece, quality, imageUrl, filename: file.name });
    setUploadState('review');
    const scannedBy = engineLabel(piece.scannedBy);
    const elapsed = scanSeconds(piece.scanMeta);
    const scanDetail = [scannedBy, elapsed].filter(Boolean).join(' in ');
    setUploadMessage(
      quality.status === 'fail'
        ? `"${file.name}" scanned${scanDetail ? ` with ${scanDetail}` : ''}, but it failed quality checks.`
        : `"${piece.title}" scanned${scanDetail ? ` with ${scanDetail}` : ''}. Review it before practice.`,
    );
  }

  async function handleXmlFileUpload(e) {
    const file = e.target.files[0];
    const source = xmlImportSourceRef.current;
    xmlImportSourceRef.current = 'direct-import';
    if (!file) return;
    e.target.value = '';
    setUploadFile(file.name);
    setUploadMessage('');
    await handleXmlImport(file, source);
  }

  async function handleImageFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setUploadFile(file.name);
    setUploadMessage('');

    if (file.name.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) {
      await handleImageScan(file);
    } else {
      setUploadState('error');
      setUploadMessage('Unsupported file type. Upload a PNG, JPG, or WebP for scan.');
    }
  }

  function discardPendingScan() {
    setPendingScan(null);
    setUploadState('idle');
    setUploadMessage('');
  }

  function approvePendingScan() {
    if (!pendingScan || pendingScan.quality.status === 'fail') return;
    const piece = {
      ...pendingScan.piece,
      title: reviewEdits.title.trim() || pendingScan.piece.title,
      composer: reviewEdits.composer.trim() || 'Unknown',
      clef: reviewEdits.clef || pendingScan.piece.clef,
      bpm: Number(reviewEdits.bpm) || pendingScan.piece.bpm,
      scanQuality: pendingScan.quality,
      reviewedAt: new Date().toISOString(),
    };
    persistPiece(piece);
    setPendingScan(null);
    setUploadState('success');
    setUploadMessage(`"${piece.title}" imported after review.`);
  }

  const busy = uploadState === 'reading' || uploadState === 'scanning';
  const engineChip = (() => {
    if (!serverHealth) return null;
    if (!serverHealth.ok) return { label: 'OMR offline', color: 'text-feedback-error/70 border-feedback-error/20' };
    const e = serverHealth.engines ?? {};
    const active = serverHealth.engineOrder?.length
      ? serverHealth.engineOrder.map(engineLabel)
      : [e.audiveris && 'Audiveris', e.oemer && 'Oemer', e.remote && 'Remote'].filter(Boolean);
    if (active.length === 0) return { label: 'No engine', color: 'text-accent-amber/70 border-accent-amber/20' };
    return { label: `Open OMR: ${active.join(' -> ')}`, color: 'text-feedback-success/80 border-feedback-success/20' };
  })();

  const banner = uploadState === 'idle' ? null : {
    reading: { icon: <Loader2 size={16} className="animate-spin" />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: `Reading "${uploadFile}"...` },
    scanning: { icon: <Loader2 size={16} className="animate-spin" />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: `Scanning "${uploadFile}" with open-source OMR... Audiveris is tried first, then fallback engines if needed.` },
    review: { icon: <ScanLine size={16} />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: uploadMessage },
    success: { icon: <CheckCircle2 size={16} />, style: 'border-feedback-success/30 bg-feedback-success/10 text-feedback-success', text: uploadMessage },
    error: { icon: <AlertCircle size={16} />, style: 'border-feedback-error/30 bg-feedback-error/10 text-feedback-error', text: uploadMessage },
  }[uploadState];

  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">
      <div className="mb-8">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Repository</p>
        <h1 className="font-header text-3xl md:text-4xl text-text-primary mb-1">
          Sheet Music Library
        </h1>
        <p className="text-text-muted font-body text-sm">
          {allSongs.length} {allSongs.length === 1 ? 'piece' : 'pieces'}
          {uploadedSongs.length > 0 && (
            <span className="text-accent-amber/70"> · {uploadedSongs.length} imported</span>
          )}
          {' '}· all adapt automatically to your selected instrument
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by title, composer..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-bg-panel border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-text-primary font-body text-sm placeholder-text-muted focus:outline-none focus:border-accent-amber/60 transition-colors"
          />
        </div>

        <button
          onClick={() => { if (!busy) { setShowPlayScoreGuide(true); } }}
          disabled={busy}
          className="flex items-center justify-center gap-2 bg-accent-amber text-bg-deep font-body font-semibold px-5 py-2.5 rounded-lg hover:shadow-[0_0_20px_rgba(201,162,39,0.5)] transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Smartphone size={15} />
          PlayScore 2
        </button>

        <button
          onClick={() => { if (!busy) { chooseXmlFile('direct-import'); } }}
          disabled={busy}
          className="flex items-center justify-center gap-2 bg-bg-panel border border-white/10 text-text-primary font-body font-semibold px-5 py-2.5 rounded-lg hover:border-accent-amber/50 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadState === 'reading'
            ? <Loader2 size={15} className="animate-spin" />
            : <FileMusic size={15} />}
          {uploadState === 'reading' ? 'Reading...' : 'Upload MusicXML'}
        </button>

        <button
          onClick={() => { if (!busy) { setUploadState('idle'); imageInputRef.current?.click(); } }}
          disabled={busy}
          className="flex items-center justify-center gap-2 bg-bg-panel border border-white/10 text-text-primary font-body font-semibold px-5 py-2.5 rounded-lg hover:border-accent-amber/50 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadState === 'scanning'
            ? <Loader2 size={15} className="animate-spin" />
            : <ScanLine size={15} />}
          {uploadState === 'scanning' ? 'Scanning...' : 'Open OMR Scan'}
        </button>

        <input
          ref={xmlInputRef}
          type="file"
          accept=".xml,.musicxml,.mxl"
          className="hidden"
          onChange={handleXmlFileUpload}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={handleImageFileUpload}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <p className="text-text-muted/50 font-body text-xs flex items-center gap-1.5">
          <FileMusic size={11} />
          <span className="text-text-muted">MusicXML</span> · instant and most accurate ·
          <Smartphone size={11} className="ml-1" />
          <span className="text-text-muted">PlayScore 2</span> · scan then export MusicXML ·
          <ScanLine size={11} className="ml-1" />
          <span className="text-text-muted">Screenshot/photo</span> · open-source OMR with review gate
        </p>
        {engineChip && (
          <span className={`flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full border ${engineChip.color}`}>
            <Cpu size={9} /> {engineChip.label}
          </span>
        )}
      </div>

      {banner && (
        <div className={`flex items-start gap-3 mb-5 px-4 py-3 rounded-xl border ${banner.style}`}>
          <span className="flex-shrink-0 mt-0.5">{banner.icon}</span>
          <p className="font-body text-sm flex-1 min-w-0 whitespace-pre-line">{banner.text}</p>
          {(uploadState === 'error' || uploadState === 'success') && (
            <button onClick={() => setUploadState('idle')} className="text-xs opacity-50 hover:opacity-100 flex-shrink-0">x</button>
          )}
        </div>
      )}

      {showPlayScoreGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <section className="w-full max-w-2xl rounded-xl border border-white/10 bg-bg-panel shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-accent-amber font-body text-[10px] uppercase tracking-widest">MusicXML Import</p>
                <h2 className="font-header text-2xl text-text-primary">PlayScore 2</h2>
              </div>
              <button
                onClick={() => setShowPlayScoreGuide(false)}
                className="h-9 w-9 rounded-lg border border-white/10 text-text-muted hover:text-text-primary hover:border-white/25 flex items-center justify-center"
                aria-label="Close PlayScore import"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {[
                  ['1', 'Scan', 'Capture the page in PlayScore 2.'],
                  ['2', 'Export', 'Save as MusicXML or MXL.'],
                  ['3', 'Import', 'Open that file here.'],
                ].map(([step, title, copy]) => (
                  <div key={step} className="rounded-lg border border-white/10 bg-bg-deep/50 p-4">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-amber text-bg-deep font-body text-xs font-bold mb-3">
                      {step}
                    </span>
                    <h3 className="font-body text-sm font-semibold text-text-primary mb-1">{title}</h3>
                    <p className="font-body text-xs leading-relaxed text-text-muted">{copy}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-accent-amber/20 bg-accent-amber/5 px-4 py-3 mb-5">
                <p className="font-body text-sm text-text-primary">
                  Use the exported MusicXML file for practice feedback. It is much more reliable than asking the local screenshot scanner to guess a dense classical page.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                <a
                  href={PLAYSCORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 font-body text-sm font-semibold text-text-primary hover:border-accent-amber/50 transition-colors"
                >
                  <ExternalLink size={15} />
                  Open PlayScore
                </a>
                <button
                  onClick={() => chooseXmlFile('playscore')}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent-amber px-4 py-2.5 font-body text-sm font-semibold text-bg-deep hover:shadow-[0_0_20px_rgba(201,162,39,0.45)] transition-all"
                >
                  <Upload size={15} />
                  Choose MusicXML
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {pendingScan && (
        <section className="mb-6 rounded-xl border border-white/10 bg-bg-panel/80 overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 border-b border-white/10">
              <div>
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest">Open OMR Review</p>
                <h3 className="font-header text-xl text-text-primary">{reviewEdits.title || pendingScan.piece.title}</h3>
                <p className="text-text-muted/70 font-body text-xs">{pendingScan.filename}</p>
              </div>
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-body font-semibold ${QUALITY_BADGE[pendingScan.quality.status]}`}>
                {pendingScan.quality.status === 'pass' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {pendingScan.quality.status.toUpperCase()} · {pendingScan.quality.score}/100
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
              <div>
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Original Image</p>
                <div className="bg-white rounded-lg overflow-auto max-h-[420px] border border-white/10">
                  <img src={pendingScan.imageUrl} alt="Original scanned sheet music" className="w-full min-w-[320px] object-contain" />
                </div>
              </div>
              <div>
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Parsed Score</p>
                <OsmdViewer
                  musicXml={pendingScan.piece.musicXmlString}
                  className="max-h-[420px] overflow-auto border border-white/10 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-4 px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="font-body text-xs text-text-muted">
                  Title
                  <input value={reviewEdits.title} onChange={e => setReviewEdits(prev => ({ ...prev, title: e.target.value }))} className="mt-1 w-full bg-bg-panel border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60" />
                </label>
                <label className="font-body text-xs text-text-muted">
                  Composer
                  <input value={reviewEdits.composer} onChange={e => setReviewEdits(prev => ({ ...prev, composer: e.target.value }))} className="mt-1 w-full bg-bg-panel border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60" />
                </label>
                <label className="font-body text-xs text-text-muted">
                  Clef
                  <select value={reviewEdits.clef} onChange={e => setReviewEdits(prev => ({ ...prev, clef: e.target.value }))} className="mt-1 w-full bg-bg-panel border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary capitalize focus:outline-none focus:border-accent-amber/60">
                    {CLEF_OPTIONS.map(clef => <option key={clef} value={clef}>{clef}</option>)}
                  </select>
                </label>
                <label className="font-body text-xs text-text-muted">
                  BPM
                  <input type="number" min="30" max="240" value={reviewEdits.bpm} onChange={e => setReviewEdits(prev => ({ ...prev, bpm: e.target.value }))} className="mt-1 w-full bg-bg-panel border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60" />
                </label>
              </div>

              <div className="rounded-lg border border-white/10 bg-bg-panel/60 p-3">
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Quality Checks</p>
                {[...pendingScan.quality.issues, ...pendingScan.quality.warnings].length > 0 ? (
                  <ul className="space-y-2">
                    {pendingScan.quality.issues.map(item => (
                      <li key={`issue-${item}`} className="flex gap-2 text-feedback-error font-body text-xs">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span>{item}</span>
                      </li>
                    ))}
                    {pendingScan.quality.warnings.map(item => (
                      <li key={`warning-${item}`} className="flex gap-2 text-accent-amber font-body text-xs">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 text-feedback-success font-body text-xs">
                    <CheckCircle2 size={13} /> No blocking scan problems found.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                  {pendingScan.quality.metrics.measureCount} measures
                </span>
                <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                  {pendingScan.quality.metrics.noteCount} notes
                </span>
                <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                  {engineLabel(pendingScan.piece.scannedBy)}
                </span>
                {pendingScan.piece.preprocessing && (
                  <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                    {pendingScan.piece.preprocessing}
                  </span>
                )}
                {scanSeconds(pendingScan.piece.scanMeta) && (
                  <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                    {scanSeconds(pendingScan.piece.scanMeta)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={discardPendingScan} className="px-4 py-2 rounded-lg border border-white/10 text-text-muted font-body text-sm hover:text-text-primary">
                  Discard
                </button>
                <button
                  onClick={approvePendingScan}
                  disabled={pendingScan.quality.status === 'fail'}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-amber text-bg-deep font-body font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Approve Import <ChevronRight size={14} />
                </button>
              </div>
            </div>
        </section>
      )}

      <section>
        <div className="flex gap-2 flex-wrap mb-3">
          {INSTRUMENT_FILTERS.map(inst => (
            <button
              key={inst}
              onClick={() => setFilterInstr(inst)}
              className={`px-3 py-1.5 rounded-full text-xs font-body uppercase tracking-wide transition-all border
                ${filterInstr === inst
                  ? 'bg-accent-amber text-bg-deep border-accent-amber'
                  : 'bg-bg-panel text-text-muted border-white/10 hover:border-white/25'}`}
            >
              {inst}
            </button>
          ))}
        </div>

        <p className="text-text-muted font-body text-xs mb-5">
          <span className="text-accent-amber">▶</span>{' '}
          Sheet music will be auto-transposed for{' '}
          <span className="text-text-primary font-medium">
            {INSTR_LABEL[instrument] ?? 'your instrument'}
          </span>
          {' '}when you practice.
        </p>

        <p className="text-text-muted font-body text-xs uppercase tracking-widest mb-4">
          {filteredSongs.length} {filteredSongs.length === 1 ? 'piece' : 'pieces'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredSongs.map(piece => (
            <div
              key={piece.id}
              className={`group bg-bg-panel rounded-xl border p-5 flex flex-col gap-3 hover:border-accent-amber/30 transition-all
                ${piece.scanBlocked
                  ? 'border-feedback-error/30 bg-feedback-error/[0.03]'
                  : piece.isUploaded ? 'border-accent-amber/20 bg-accent-amber/[0.03]' : 'border-white/5'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                  ${piece.scanBlocked ? 'bg-feedback-error/10' : piece.isUploaded ? 'bg-accent-amber/10' : 'bg-white/5'}`}
                >
                  {piece.isUploaded
                    ? <FileMusic size={16} className={piece.scanBlocked ? 'text-feedback-error' : 'text-accent-amber'} />
                    : <Music2 size={16} className="text-accent-amber" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-header text-base text-text-primary leading-tight">{piece.title}</h3>
                  <p className="text-text-muted font-body text-xs mt-0.5">{piece.composer || 'Unknown'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {piece.isUploaded && (
                  <span className={`flex items-center gap-1 text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full border
                    ${piece.scanBlocked
                      ? 'border-feedback-error/40 text-feedback-error bg-feedback-error/10'
                      : 'border-accent-amber/40 text-accent-amber bg-accent-amber/10'}`}
                  >
                    {piece.scanBlocked
                      ? <><AlertCircle size={8} /> Needs rescan</>
                      : piece.scannedBy === 'playscore-musicxml'
                      ? <><Smartphone size={8} /> PlayScore 2</>
                      : piece.scannedBy && piece.scannedBy !== 'direct-import'
                      ? <><ScanLine size={8} /> {engineLabel(piece.scannedBy)}</>
                      : <><FileMusic size={8} /> MusicXML</>}
                  </span>
                )}
                {!piece.isUploaded && piece.instrument === 'all' ? (
                  <span className="flex items-center gap-1 text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent-amber/25 text-accent-amber/80 bg-accent-amber/5">
                    <Layers size={8} /> All Instruments
                  </span>
                ) : !piece.isUploaded && piece.instrument ? (
                  <span className="text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-text-muted capitalize border border-white/10">
                    {piece.instrument}
                  </span>
                ) : null}
                {piece.difficulty && (
                  <span className={`text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full border ${DIFFICULTY_COLOR[piece.difficulty] || 'text-text-muted border-white/10'}`}>
                    {piece.difficulty}
                  </span>
                )}
              </div>

              {piece.bpm && (
                <p className="text-text-muted/60 font-body text-[10px]">
                  {piece.bpm} BPM · {piece.keySignature ?? 'C'} {piece.timeSignature ?? '4/4'}
                  {piece.isUploaded && piece.measures?.length > 0 && (
                    <> · {piece.measures.length} measures</>
                  )}
                </p>
              )}

              {piece.scanBlocked && (
                <p className="text-feedback-error font-body text-[11px] leading-snug">
                  Scan blocked: {piece.scanQuality?.issues?.[0] ?? 'OMR output was not reliable enough to practice.'}
                </p>
              )}

              <button
                onClick={() => practicePiece(piece)}
                disabled={piece.scanBlocked}
                className={`mt-auto flex items-center justify-between w-full px-4 py-2.5 rounded-lg text-sm font-body font-medium transition-all
                  ${piece.scanBlocked
                    ? 'bg-feedback-error/10 text-feedback-error cursor-not-allowed'
                    : 'bg-accent-amber/10 text-accent-amber hover:bg-accent-amber hover:text-bg-deep group-hover:shadow-[0_0_14px_rgba(201,162,39,0.3)]'}`}
              >
                <span>{piece.scanBlocked ? 'Scan Failed' : 'Practice Now'}</span>
                <ChevronRight size={14} />
              </button>
            </div>
          ))}
        </div>

        {filteredSongs.length === 0 && (
          <div className="text-center py-16 text-text-muted font-body">
            <Music2 size={32} className="mx-auto mb-3 opacity-30" />
            <p>No pieces match "{query || filterInstr}".</p>
          </div>
        )}
      </section>
    </div>
  );
}
