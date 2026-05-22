import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import {
  AlertCircle, CheckCircle2, ChevronRight, Cpu, FileMusic,
  Gauge, Loader2, Music2, Play, ScanLine, Shuffle, Sparkles,
  Layers, Search, Target, Timer, Upload,
} from 'lucide-react';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { PIECES_LIST } from '../utils/samplePieces.js';
import { generateRandomScore, RANDOM_OPTIONS_KEY } from '../utils/randomScoreGenerator.js';
import { parseMusicXml } from '../utils/musicXmlParser.js';
import { checkServerHealth, scanSheetMusicImage } from '../utils/omrClient.js';
import { evaluateScanQuality } from '../utils/scanQuality.js';
import OsmdViewer from '../components/OsmdViewer.jsx';

const INSTRUMENT_FILTERS = ['All', 'Violin', 'Viola', 'Cello', 'Double Bass'];

const MEASURE_OPTIONS = [
  { label: 'Random 8-16', value: 'random' },
  { label: '8 measures', value: '8' },
  { label: '12 measures', value: '12' },
  { label: '16 measures', value: '16' },
];

const TIME_OPTIONS = [
  { label: 'Random meter', value: 'random' },
  { label: '3/4', value: '3/4' },
  { label: '4/4', value: '4/4' },
];

const BPM_OPTIONS = [60, 72, 80, 88, 100];

const INSTR_LABEL = {
  violin: 'Violin',
  viola: 'Viola',
  cello: 'Cello',
  bass: 'Double Bass',
};

const LS_UPLOADS = 'virtual_concertmaster_uploads';
const CLEF_OPTIONS = ['treble', 'alto', 'bass'];

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

function buildOptions({ measures, timeSignature, bpm }) {
  return {
    ...(measures === 'random' ? {} : { measureCount: Number(measures) }),
    ...(timeSignature === 'random' ? {} : { timeSignature }),
    bpm: Number(bpm),
  };
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

export default function Library() {
  const navigate = useNavigate();
  const { instrument } = useInstrumentStore();
  const [measures, setMeasures] = useState('random');
  const [timeSignature, setTimeSignature] = useState('random');
  const [bpm, setBpm] = useState('80');
  const [preview, setPreview] = useState(() => generateRandomScore({ instrument }));
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

  const launchOptions = useMemo(
    () => buildOptions({ measures, timeSignature, bpm }),
    [measures, timeSignature, bpm],
  );

  const allSongs = useMemo(() => [...uploadedSongs, ...PIECES_LIST], [uploadedSongs]);
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

  function previewQuest() {
    setPreview(generateRandomScore({ instrument, ...launchOptions }));
  }

  useEffect(() => {
    setPreview(generateRandomScore({ instrument, ...launchOptions }));
  }, [instrument]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    checkServerHealth().then(setServerHealth);
  }, []);

  useEffect(() => () => {
    if (pendingScan?.imageUrl) URL.revokeObjectURL(pendingScan.imageUrl);
  }, [pendingScan?.imageUrl]);

  function startQuest() {
    sessionStorage.setItem(RANDOM_OPTIONS_KEY, JSON.stringify(launchOptions));
    navigate('/practice', {
      state: {
        randomSeed: Date.now(),
        randomOptions: launchOptions,
      },
    });
  }

  function persistPiece(piece) {
    const saved = loadSavedUploads();
    const next = [piece, ...saved.filter(p => p.id !== piece.id)];
    localStorage.setItem(LS_UPLOADS, JSON.stringify(next));
    setUploadedSongs(next);
  }

  function practicePiece(piece) {
    sessionStorage.setItem('selectedPiece', piece.id);
    navigate('/practice', { state: { pieceId: piece.id } });
  }

  async function handleXmlImport(file) {
    setUploadState('reading');
    setPendingScan(null);

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
      difficulty: 'Imported',
      isUploaded: true,
      uploadedAt: new Date().toISOString(),
      scannedBy: 'direct-import',
      musicXmlString: xmlText,
      measures: parsed.measures,
    };

    persistPiece(piece);
    setUploadState('success');
    setUploadMessage(`"${piece.title}" imported. Opening practice.`);
    practicePiece(piece);
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
    setUploadMessage(
      quality.status === 'fail'
        ? `"${file.name}" scanned, but it failed quality checks.`
        : `"${piece.title}" scanned. Review it before practice.`,
    );
  }

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
    setUploadMessage(`"${piece.title}" imported after review. Opening practice.`);
    practicePiece(piece);
  }

  const busy = uploadState === 'reading' || uploadState === 'scanning';
  const engineChip = (() => {
    if (!serverHealth) return null;
    if (!serverHealth.ok) return { label: 'OMR offline', color: 'text-feedback-error/70 border-feedback-error/20' };
    const e = serverHealth.engines ?? {};
    const active = [e.oemer && 'Oemer', e.audiveris && 'Audiveris', e.remote && 'Remote'].filter(Boolean);
    if (active.length === 0) return { label: 'No engine', color: 'text-accent-amber/70 border-accent-amber/20' };
    return { label: active.join(' · '), color: 'text-feedback-success/80 border-feedback-success/20' };
  })();

  const banner = uploadState === 'idle' ? null : {
    reading: { icon: <Loader2 size={16} className="animate-spin" />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: `Reading "${uploadFile}"...` },
    scanning: { icon: <Loader2 size={16} className="animate-spin" />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: `Scanning "${uploadFile}"... this can take several minutes locally.` },
    review: { icon: <ScanLine size={16} />, style: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber', text: uploadMessage },
    success: { icon: <CheckCircle2 size={16} />, style: 'border-feedback-success/30 bg-feedback-success/10 text-feedback-success', text: uploadMessage },
    error: { icon: <AlertCircle size={16} />, style: 'border-feedback-error/30 bg-feedback-error/10 text-feedback-error', text: uploadMessage },
  }[uploadState];

  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">
      <div className="mb-8">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Repository</p>
        <h1 className="font-header text-3xl md:text-4xl text-text-primary mb-2">
          Sheet Music Library
        </h1>
        <p className="text-text-muted font-body text-sm max-w-2xl">
          {allSongs.length} {allSongs.length === 1 ? 'piece' : 'pieces'} · {uploadedSongs.length} imported ·
          upload real repertoire, scan printed pages, or start a random sight-reading quest.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)] gap-5">
        <section className="bg-bg-panel rounded-xl border border-white/5 p-5">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-lg bg-accent-amber/15 text-accent-amber flex items-center justify-center">
              <Shuffle size={18} />
            </div>
            <div>
              <h2 className="font-header text-xl text-text-primary">Quest Setup</h2>
              <p className="text-text-muted font-body text-xs">{INSTR_LABEL[instrument]} · generated on demand</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="flex items-center gap-1.5 text-text-muted font-body text-xs uppercase tracking-widest mb-2">
                <Music2 size={12} /> Length
              </span>
              <select
                value={measures}
                onChange={e => setMeasures(e.target.value)}
                className="w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2.5 text-text-primary font-body text-sm focus:outline-none focus:border-accent-amber/60"
              >
                {MEASURE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="flex items-center gap-1.5 text-text-muted font-body text-xs uppercase tracking-widest mb-2">
                <Timer size={12} /> Meter
              </span>
              <select
                value={timeSignature}
                onChange={e => setTimeSignature(e.target.value)}
                className="w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2.5 text-text-primary font-body text-sm focus:outline-none focus:border-accent-amber/60"
              >
                {TIME_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="flex items-center gap-1.5 text-text-muted font-body text-xs uppercase tracking-widest mb-2">
                <Gauge size={12} /> Tempo
              </span>
              <select
                value={bpm}
                onChange={e => setBpm(e.target.value)}
                className="w-full bg-bg-deep border border-white/10 rounded-lg px-3 py-2.5 text-text-primary font-body text-sm focus:outline-none focus:border-accent-amber/60"
              >
                {BPM_OPTIONS.map(value => (
                  <option key={value} value={value}>{value} BPM</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={startQuest}
              className="flex items-center justify-center gap-2 bg-accent-amber text-bg-deep font-body font-semibold px-5 py-3 rounded-xl hover:shadow-[0_0_22px_rgba(201,162,39,0.45)] transition-all"
            >
              <Play size={16} fill="currentColor" /> Start Quest
            </button>
            <button
              onClick={previewQuest}
              className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-text-muted font-body font-semibold px-5 py-3 rounded-xl hover:text-text-primary hover:border-white/20 transition-all"
            >
              <Shuffle size={16} /> Roll Preview
            </button>
          </div>
        </section>

        <section className="bg-bg-panel rounded-xl border border-white/5 p-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Next Roll</p>
              <h2 className="font-header text-xl text-text-primary">{preview.title}</h2>
            </div>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-accent-amber/30 bg-accent-amber/10 text-accent-amber font-body text-xs">
              <Sparkles size={12} /> Random
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              ['Measures', preview.events.length],
              ['Meter', preview.timeSignature],
              ['Tempo', `${preview.bpm}`],
              ['Clef', preview.clef],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-bg-deep/60 px-3 py-3">
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-1">{label}</p>
                <p className="font-header text-2xl text-text-primary capitalize">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-deep/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target size={15} className="text-accent-amber" />
              <p className="text-text-primary font-body text-sm font-semibold">Generated note stream</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {preview.events.flat().slice(0, 48).map((event, idx) => (
                <span
                  key={`${event.name}-${idx}`}
                  className={`px-2 py-1 rounded-md border font-body text-xs
                    ${event.isRest
                      ? 'border-white/10 text-text-muted/50 bg-white/5'
                      : 'border-accent-amber/25 text-accent-amber bg-accent-amber/5'}`}
                >
                  {event.name}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6 bg-bg-panel rounded-xl border border-white/5 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
          <div>
            <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Your Music</p>
            <h2 className="font-header text-2xl text-text-primary">Upload MusicXML or Scan a Page</h2>
            <p className="text-text-muted font-body text-sm max-w-2xl">
              MusicXML opens practice immediately. Photos and screenshots go through OMR, then a review gate before feedback.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => { if (!busy) xmlInputRef.current?.click(); }}
              disabled={busy}
              className="flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-text-primary font-body font-semibold px-5 py-3 rounded-xl hover:border-accent-amber/50 transition-all disabled:opacity-50"
            >
              {uploadState === 'reading' ? <Loader2 size={16} className="animate-spin" /> : <FileMusic size={16} />}
              Upload MusicXML
            </button>
            <button
              onClick={() => { if (!busy) imageInputRef.current?.click(); }}
              disabled={busy}
              className="flex items-center justify-center gap-2 bg-accent-amber text-bg-deep font-body font-semibold px-5 py-3 rounded-xl hover:shadow-[0_0_22px_rgba(201,162,39,0.45)] transition-all disabled:opacity-50"
            >
              {uploadState === 'scanning' ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
              Scan Image
            </button>
          </div>
        </div>

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

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <p className="text-text-muted/60 font-body text-xs flex items-center gap-1.5">
            <Upload size={11} />
            Direct MusicXML is fastest · image scans are useful but must be checked before practice
          </p>
          {engineChip && (
            <span className={`flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full border ${engineChip.color}`}>
              <Cpu size={9} /> {engineChip.label}
            </span>
          )}
          <span className="text-text-muted/50 font-body text-[10px] uppercase tracking-widest">
            {uploadedSongs.length} imported
          </span>
        </div>

        {banner && (
          <div className={`flex items-start gap-3 mb-4 px-4 py-3 rounded-xl border ${banner.style}`}>
            <span className="flex-shrink-0 mt-0.5">{banner.icon}</span>
            <p className="font-body text-sm flex-1 whitespace-pre-line">{banner.text}</p>
            {(uploadState === 'error' || uploadState === 'success') && (
              <button onClick={() => setUploadState('idle')} className="opacity-50 hover:opacity-100">x</button>
            )}
          </div>
        )}

        {pendingScan && (
          <div className="rounded-xl border border-white/10 bg-bg-deep/50 overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 border-b border-white/10">
              <div>
                <p className="text-text-muted font-body text-[10px] uppercase tracking-widest">Scan Review</p>
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
                  Practice Imported Piece <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
        </div>

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
                ${piece.isUploaded ? 'border-accent-amber/20 bg-accent-amber/[0.03]' : 'border-white/5'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                  ${piece.isUploaded ? 'bg-accent-amber/10' : 'bg-white/5'}`}
                >
                  {piece.isUploaded
                    ? <FileMusic size={16} className="text-accent-amber" />
                    : <Music2 size={16} className="text-accent-amber" />}
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
                onClick={() => practicePiece(piece)}
                className="mt-auto flex items-center justify-between w-full px-4 py-2.5 rounded-lg text-sm font-body font-medium transition-all bg-accent-amber/10 text-accent-amber hover:bg-accent-amber hover:text-bg-deep group-hover:shadow-[0_0_14px_rgba(201,162,39,0.3)]"
              >
                <span>Practice Now</span>
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
