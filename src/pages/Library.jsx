import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import {
  Search, Music2, ChevronRight, Loader2,
  Layers, FileMusic, AlertCircle, CheckCircle2,
  ScanLine, Cpu,
} from 'lucide-react';
import { PIECES_LIST }                     from '../utils/samplePieces.js';
import { useInstrumentStore }              from '../store/instrumentStore.js';
import { parseMusicXml }                   from '../utils/musicXmlParser.js';
import { checkServerHealth, scanSheetMusicImage } from '../utils/omrClient.js';
import { evaluateScanQuality }             from '../utils/scanQuality.js';
import OsmdViewer                          from '../components/OsmdViewer.jsx';

// ── Constants ─────────────────────────────────────────────────────

const INSTRUMENT_FILTERS = ['All', 'Violin', 'Viola', 'Cello', 'Double Bass'];
const LS_UPLOADS         = 'virtual_concertmaster_uploads';

const DIFFICULTY_COLOR = {
  Beginner:     'text-feedback-success border-feedback-success/30 bg-feedback-success/5',
  Intermediate: 'text-accent-amber border-accent-amber/30 bg-accent-amber/5',
  Advanced:     'text-feedback-error border-feedback-error/30 bg-feedback-error/5',
};

const INSTR_LABEL = {
  violin: 'Violin', viola: 'Viola', cello: 'Cello', bass: 'Double Bass',
};

const CLEF_OPTIONS = ['treble', 'alto', 'bass'];

const QUALITY_BADGE = {
  pass: {
    label: 'Ready',
    className: 'border-feedback-success/40 text-feedback-success bg-feedback-success/10',
  },
  review: {
    label: 'Review',
    className: 'border-accent-amber/40 text-accent-amber bg-accent-amber/10',
  },
  fail: {
    label: 'Blocked',
    className: 'border-feedback-error/40 text-feedback-error bg-feedback-error/10',
  },
};

// ── Helpers ───────────────────────────────────────────────────────

function loadSavedUploads() {
  try { return JSON.parse(localStorage.getItem(LS_UPLOADS) || '[]'); }
  catch { return []; }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
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
        base64:    data,
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

  if (!xmlFile) {
    throw new Error('The compressed MusicXML file did not contain a readable score.');
  }

  return xmlFile.async('text');
}

// ── Component ─────────────────────────────────────────────────────

export default function Library() {
  const navigate = useNavigate();
  const { instrument: activeInstrument } = useInstrumentStore();

  const [query,       setQuery]       = useState('');
  const [filterInstr, setFilterInstr] = useState('All');
  const xmlInputRef   = useRef(null);
  const imageInputRef = useRef(null);

  // ── Server / engine health ────────────────────────────────────
  // null = not yet checked, false = offline, object = health payload
  const [serverHealth, setServerHealth] = useState(null);

  useEffect(() => {
    checkServerHealth().then(setServerHealth);
  }, []);

  // ── Upload state machine ──────────────────────────────────────
  // 'idle' | 'reading' | 'scanning' | 'review' | 'success' | 'error'
  const [uploadState,   setUploadState]   = useState('idle');
  const [uploadFile,    setUploadFile]    = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [pendingScan,   setPendingScan]   = useState(null);
  const [reviewEdits,   setReviewEdits]   = useState({ title: '', composer: '', clef: 'treble', bpm: 80 });

  // ── Persisted uploads ─────────────────────────────────────────
  const [uploadedSongs, setUploadedSongs] = useState(loadSavedUploads);

  useEffect(() => () => {
    if (pendingScan?.imageUrl) URL.revokeObjectURL(pendingScan.imageUrl);
  }, [pendingScan?.imageUrl]);

  const allSongs = [...uploadedSongs, ...PIECES_LIST];

  const filtered = allSongs.filter(p => {
    const matchInstr =
      filterInstr === 'All' ||
      p.instrument === 'all' ||
      p.instrument?.toLowerCase() === filterInstr.toLowerCase();
    const matchQuery =
      !query ||
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.composer?.toLowerCase().includes(query.toLowerCase());
    return matchInstr && matchQuery;
  });

  // ── Persist a finished piece ──────────────────────────────────
  function persistPiece(piece) {
    const saved = loadSavedUploads();
    const next  = [piece, ...saved.filter(p => p.id !== piece.id)];
    localStorage.setItem(LS_UPLOADS, JSON.stringify(next));
    setUploadedSongs(next);
  }

  // ── MusicXML direct import (.xml / .musicxml) ─────────────────
  async function handleXmlImport(file) {
    setUploadState('reading');
    setPendingScan(null);

    if (file.size > 20 * 1024 * 1024) {
      setUploadState('error');
      setUploadMessage('File is too large (max 20 MB).');
      return;
    }

    let xmlText;
    try { xmlText = await readMusicXmlFromFile(file); }
    catch {
      setUploadState('error');
      setUploadMessage('Could not read the file.');
      return;
    }

    const trimmed = xmlText.trimStart();
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<score-')) {
      setUploadState('error');
      setUploadMessage('This does not look like a MusicXML file. Upload .musicxml, .xml, or compressed .mxl.');
      return;
    }

    const parsed = parseMusicXml(xmlText, 80);
    const titleFallback = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

    const piece = {
      id:             `upload_${Date.now()}`,
      title:          (parsed.title && parsed.title !== 'Untitled') ? parsed.title : titleFallback,
      composer:       parsed.composer     || 'Unknown',
      clef:           parsed.clef         || 'treble',
      keySignature:   parsed.keySignature || 'C',
      timeSignature:  parsed.timeSignature || '4/4',
      bpm:            parsed.bpm          || 80,
      instrument:     'all',
      difficulty:     'Beginner',
      isUploaded:     true,
      uploadedAt:     new Date().toISOString(),
      scannedBy:      'direct-import',
      musicXmlString: xmlText,
      measures:       parsed.measures,
    };

    persistPiece(piece);

    const noteCount    = piece.measures.reduce((s, m) => s + m.length, 0);
    const measureLabel = `${piece.measures.length} measure${piece.measures.length !== 1 ? 's' : ''}`;
    const noteLabel    = noteCount > 0 ? `, ${noteCount} tracked notes` : ' (visual display only)';
    setUploadState('success');
    setUploadMessage(`"${piece.title}" imported — ${measureLabel}${noteLabel}`);
  }

  // ── Image scan via OMR server (.png / .jpg / .webp) ───────────
  async function handleImageScan(file) {
    setPendingScan(null);

    // Re-check server health before starting a potentially slow scan
    const health = await checkServerHealth();
    setServerHealth(health);

    if (!health.ok) {
      setUploadState('error');
      setUploadMessage(
        'OMR server is not running.\n' +
        'Start it in a terminal:  npm run dev:api\n\n' +
        'Then install an engine:  pip install oemer',
      );
      return;
    }

    if (!health.anyAvailable) {
      setUploadState('error');
      setUploadMessage(
        'The OMR server is running but no engine is installed.\n\n' +
        'Install Oemer:  pip install oemer\n' +
        'Then restart the server:  npm run dev:api',
      );
      return;
    }

    if (file.size > 14 * 1024 * 1024) {
      setUploadState('error');
      setUploadMessage('Image too large (max 14 MB). Use a smaller or cropped photo.');
      return;
    }

    setUploadState('scanning');

    let base64, mediaType;
    try {
      ({ base64, mediaType } = await readFileAsBase64(file));
    } catch {
      setUploadState('error');
      setUploadMessage('Could not read the image file.');
      return;
    }

    const result = await scanSheetMusicImage({ base64, mediaType, filename: file.name });

    if (!result.success) {
      setUploadState('error');
      setUploadMessage(result.error ?? 'OMR scan failed.');
      return;
    }

    const { piece } = result;
    const noteCount = piece.measures.reduce((s, m) => s + m.length, 0);
    const imageUrl = URL.createObjectURL(file);
    const quality = evaluateScanQuality(piece, { expectedInstrument: activeInstrument });

    setReviewEdits({
      title:    piece.title,
      composer: piece.composer,
      clef:     piece.clef,
      bpm:      piece.bpm,
    });
    setPendingScan({ piece, imageUrl, quality, filename: file.name });
    setUploadState('review');
    setUploadMessage(
      quality.status === 'fail'
        ? `"${file.name}" scanned, but the result failed quality checks.`
        : `"${piece.title}" scanned via ${piece.scannedBy} — ${piece.measures.length} measures, ${noteCount} tracked notes. Review before importing.`,
    );
  }

  // ── File-change handlers ──────────────────────────────────────
  async function handleXmlFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setUploadFile(file.name);
    setUploadMessage('');
    await handleXmlImport(file);
  }

  async function handleImageFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setUploadFile(file.name);
    setUploadMessage('');

    const name = file.name.toLowerCase();

    if (name.match(/\.(png|jpg|jpeg|webp)$/)) {
      await handleImageScan(file);
    } else {
      setUploadState('error');
      setUploadMessage('Unsupported file type. Upload a PNG, JPG, or WebP file for hybrid scan.');
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
      title:    reviewEdits.title.trim() || pendingScan.piece.title,
      composer: reviewEdits.composer.trim() || 'Unknown',
      clef:     reviewEdits.clef || pendingScan.piece.clef,
      bpm:      Number(reviewEdits.bpm) || pendingScan.piece.bpm,
      scanQuality: pendingScan.quality,
      reviewedAt:  new Date().toISOString(),
    };
    persistPiece(piece);
    setPendingScan(null);
    setUploadState('success');
    setUploadMessage(`"${piece.title}" imported after review.`);
  }

  // ── Navigate to Practice ──────────────────────────────────────
  function handlePractice(piece) {
    sessionStorage.setItem('selectedPiece', piece.id);
    navigate('/practice', { state: { pieceId: piece.id } });
  }

  // ── UI helpers ────────────────────────────────────────────────
  const bannerMap = {
    reading: {
      style: 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber',
      icon:  <Loader2 size={16} className="animate-spin flex-shrink-0" />,
      text:  `Reading "${uploadFile}"…`,
    },
    scanning: {
      style: 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber',
      icon:  <Loader2 size={16} className="animate-spin flex-shrink-0" />,
      text:  `Hybrid scan reading "${uploadFile}" — this can take several minutes locally…`,
    },
    review: {
      style: 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber',
      icon:  <ScanLine size={16} className="flex-shrink-0" />,
      text:  uploadMessage,
    },
    success: {
      style: 'bg-feedback-success/10 border-feedback-success/30 text-feedback-success',
      icon:  <CheckCircle2 size={16} className="flex-shrink-0" />,
      text:  uploadMessage,
    },
    error: {
      style: 'bg-feedback-error/10 border-feedback-error/30 text-feedback-error',
      icon:  <AlertCircle size={16} className="flex-shrink-0" />,
      text:  uploadMessage,
    },
  };
  const banner = bannerMap[uploadState];
  const busy   = uploadState === 'reading' || uploadState === 'scanning';
  const quality = pendingScan?.quality;
  const qualityBadge = quality ? QUALITY_BADGE[quality.status] : null;
  const qualityFindings = quality ? [...quality.issues, ...quality.warnings] : [];
  const canApproveScan = !!pendingScan && quality?.status !== 'fail';

  // Engine status chip
  const engineChip = (() => {
    if (!serverHealth) return null;
    if (!serverHealth.ok) return { label: 'OMR offline', color: 'text-feedback-error/70 border-feedback-error/20' };
    const e = serverHealth.engines ?? {};
    const active = [e.oemer && 'Oemer', e.audiveris && 'Audiveris', e.remote && 'Remote'].filter(Boolean);
    if (active.length === 0) return { label: 'No engine', color: 'text-accent-amber/70 border-accent-amber/20' };
    return { label: active.join(' · '), color: 'text-feedback-success/80 border-feedback-success/20' };
  })();

  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Repository</p>
        <h1 className="font-header text-3xl md:text-4xl text-text-primary mb-1">Sheet Music Library</h1>
        <p className="text-text-muted font-body text-sm">
          {allSongs.length} {allSongs.length === 1 ? 'piece' : 'pieces'}
          {uploadedSongs.length > 0 && (
            <span className="text-accent-amber/70"> · {uploadedSongs.length} imported</span>
          )}
          {' '}· all adapt automatically to your selected instrument
        </p>
      </div>

      {/* ── Search + Import row ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by title, composer…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-bg-panel border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-text-primary font-body text-sm placeholder-text-muted focus:outline-none focus:border-accent-amber/60 transition-colors"
          />
        </div>

        <button
          onClick={() => { if (!busy) { setUploadState('idle'); xmlInputRef.current?.click(); } }}
          disabled={busy}
          className="flex items-center gap-2 bg-bg-panel border border-white/10 text-text-primary font-body font-semibold px-5 py-2.5 rounded-lg hover:border-accent-amber/50 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy
            ? <Loader2  size={15} className="animate-spin" />
            : <FileMusic size={15} />}
          {busy ? 'Reading…' : 'Upload MusicXML'}
        </button>

        <button
          onClick={() => { if (!busy) { setUploadState('idle'); imageInputRef.current?.click(); } }}
          disabled={busy}
          className="flex items-center gap-2 bg-accent-amber text-bg-deep font-body font-semibold px-5 py-2.5 rounded-lg hover:shadow-[0_0_20px_rgba(201,162,39,0.5)] transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadState === 'scanning'
            ? <Loader2  size={15} className="animate-spin" />
            : <ScanLine size={15} />}
          {uploadState === 'scanning' ? 'Scanning…' : 'Hybrid Scan'}
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

      {/* ── Format hint + OMR engine status ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <p className="text-text-muted/50 font-body text-xs flex items-center gap-1.5">
          <FileMusic size={11} />
          <span className="text-text-muted">MusicXML</span> — instant and most accurate ·
          <ScanLine size={11} className="ml-1" />
          <span className="text-text-muted">Screenshot/photo</span> — hybrid OMR with review gate
        </p>
        {engineChip && (
          <span className={`flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full border ${engineChip.color}`}>
            <Cpu size={9} /> {engineChip.label}
          </span>
        )}
      </div>

      {/* ── Status banner ────────────────────────────────────────── */}
      {banner && uploadState !== 'idle' && (
        <div className={`flex items-start gap-3 mb-5 px-4 py-3 rounded-xl border ${banner.style}`}>
          {banner.icon}
          <p className="font-body text-sm flex-1 min-w-0 whitespace-pre-line">{banner.text}</p>
          {(uploadState === 'success' || uploadState === 'error') && (
            <button
              onClick={() => setUploadState('idle')}
              className="text-xs opacity-50 hover:opacity-100 flex-shrink-0"
            >✕</button>
          )}
        </div>
      )}

      {/* ── Hybrid scan review ──────────────────────────────────── */}
      {pendingScan && (
        <section className="mb-6 rounded-xl border border-white/10 bg-bg-panel/80 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 border-b border-white/10">
            <div className="min-w-0">
              <p className="text-text-muted font-body text-[10px] uppercase tracking-widest">Hybrid Scan Review</p>
              <h2 className="font-header text-xl text-text-primary truncate">{reviewEdits.title || pendingScan.piece.title}</h2>
              <p className="text-text-muted/70 font-body text-xs truncate">{pendingScan.filename}</p>
            </div>
            {qualityBadge && (
              <span className={`inline-flex items-center gap-2 self-start md:self-center px-3 py-1 rounded-full border text-xs font-body font-semibold ${qualityBadge.className}`}>
                {quality.status === 'pass' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {qualityBadge.label} · {quality.score}/100
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.85fr)_minmax(360px,1.15fr)] gap-4 p-4">
            <div className="min-w-0">
              <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Original Image</p>
              <div className="bg-white rounded-lg overflow-auto max-h-[440px] border border-white/10">
                <img
                  src={pendingScan.imageUrl}
                  alt="Original scanned sheet music"
                  className="w-full min-w-[320px] object-contain"
                />
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Parsed Score</p>
              <OsmdViewer
                musicXml={pendingScan.piece.musicXmlString}
                className="max-h-[440px] overflow-auto border border-white/10 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.75fr)_minmax(320px,1fr)] gap-4 px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="font-body text-xs text-text-muted">
                Title
                <input
                  value={reviewEdits.title}
                  onChange={e => setReviewEdits(prev => ({ ...prev, title: e.target.value }))}
                  className="mt-1 w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60"
                />
              </label>
              <label className="font-body text-xs text-text-muted">
                Composer
                <input
                  value={reviewEdits.composer}
                  onChange={e => setReviewEdits(prev => ({ ...prev, composer: e.target.value }))}
                  className="mt-1 w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60"
                />
              </label>
              <label className="font-body text-xs text-text-muted">
                Clef
                <select
                  value={reviewEdits.clef}
                  onChange={e => setReviewEdits(prev => ({ ...prev, clef: e.target.value }))}
                  className="mt-1 w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary capitalize focus:outline-none focus:border-accent-amber/60"
                >
                  {CLEF_OPTIONS.map(clef => (
                    <option key={clef} value={clef}>{clef}</option>
                  ))}
                </select>
              </label>
              <label className="font-body text-xs text-text-muted">
                BPM
                <input
                  type="number"
                  min="30"
                  max="240"
                  value={reviewEdits.bpm}
                  onChange={e => setReviewEdits(prev => ({ ...prev, bpm: e.target.value }))}
                  className="mt-1 w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-amber/60"
                />
              </label>
            </div>

            <div className="rounded-lg border border-white/10 bg-bg-deep/60 p-3">
              <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Quality Checks</p>
              {qualityFindings.length > 0 ? (
                <ul className="space-y-2">
                  {quality.issues.map(item => (
                    <li key={`issue-${item}`} className="flex gap-2 text-feedback-error font-body text-xs">
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                  {quality.warnings.map(item => (
                    <li key={`warning-${item}`} className="flex gap-2 text-accent-amber font-body text-xs">
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
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

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 py-3 border-t border-white/10">
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                {quality.metrics.measureCount} measures
              </span>
              <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                {quality.metrics.noteCount} notes
              </span>
              <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-white/10 text-text-muted">
                {quality.metrics.averageNotesPerMeasure} notes/measure
              </span>
              {quality.metrics.repairedRhythms > 0 && (
                <span className="text-[10px] font-body uppercase tracking-wider px-2 py-1 rounded-full border border-accent-amber/30 text-accent-amber">
                  {quality.metrics.repairedRhythms} rhythm repairs
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={discardPendingScan}
                className="px-4 py-2 rounded-lg border border-white/10 text-text-muted font-body text-sm hover:border-white/25 hover:text-text-primary transition-colors"
              >
                Discard
              </button>
              <button
                onClick={approvePendingScan}
                disabled={!canApproveScan}
                className="px-4 py-2 rounded-lg bg-accent-amber text-bg-deep font-body font-semibold text-sm hover:shadow-[0_0_20px_rgba(201,162,39,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve Import
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Instrument filter chips ──────────────────────────────── */}
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
          {INSTR_LABEL[activeInstrument] ?? 'your instrument'}
        </span>
        {' '}when you practice.
      </p>

      <p className="text-text-muted font-body text-xs uppercase tracking-widest mb-4">
        {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'}
      </p>

      {/* ── Piece grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(piece => (
          <div
            key={piece.id}
            className={`group bg-bg-panel rounded-xl border p-5 flex flex-col gap-3 hover:border-accent-amber/30 transition-all
              ${piece.isUploaded ? 'border-accent-amber/20 bg-accent-amber/[0.03]' : 'border-white/5'}`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                ${piece.isUploaded ? 'bg-accent-amber/10' : 'bg-white/5'}`}>
                {piece.isUploaded
                  ? <FileMusic size={16} className="text-accent-amber" />
                  : <Music2    size={16} className="text-accent-amber" />}
              </div>
              <div className="min-w-0">
                <h3 className="font-header text-base text-text-primary leading-tight">{piece.title}</h3>
                <p className="text-text-muted font-body text-xs mt-0.5">{piece.composer || 'Unknown'}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {piece.isUploaded && (
                <span className="flex items-center gap-1 text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent-amber/40 text-accent-amber bg-accent-amber/10">
                  {piece.scannedBy && piece.scannedBy !== 'direct-import'
                    ? <><ScanLine size={8} /> {piece.scannedBy}</>
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

            <button
              onClick={() => handlePractice(piece)}
              className="mt-auto flex items-center justify-between w-full px-4 py-2.5 rounded-lg text-sm font-body font-medium transition-all bg-accent-amber/10 text-accent-amber hover:bg-accent-amber hover:text-bg-deep group-hover:shadow-[0_0_14px_rgba(201,162,39,0.3)]"
            >
              <span>Practice Now</span>
              <ChevronRight size={14} />
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-text-muted font-body">
          <Music2 size={32} className="mx-auto mb-3 opacity-30" />
          <p>No pieces match "{query || filterInstr}".</p>
        </div>
      )}
    </div>
  );
}
