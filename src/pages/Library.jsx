import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Shuffle, Music2, Timer, Gauge, Target, Sparkles } from 'lucide-react';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { generateRandomScore, RANDOM_OPTIONS_KEY } from '../utils/randomScoreGenerator.js';

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

function buildOptions({ measures, timeSignature, bpm }) {
  return {
    ...(measures === 'random' ? {} : { measureCount: Number(measures) }),
    ...(timeSignature === 'random' ? {} : { timeSignature }),
    bpm: Number(bpm),
  };
}

export default function Library() {
  const navigate = useNavigate();
  const { instrument } = useInstrumentStore();
  const [measures, setMeasures] = useState('random');
  const [timeSignature, setTimeSignature] = useState('random');
  const [bpm, setBpm] = useState('80');
  const [preview, setPreview] = useState(() => generateRandomScore({ instrument }));

  const launchOptions = useMemo(
    () => buildOptions({ measures, timeSignature, bpm }),
    [measures, timeSignature, bpm],
  );

  function previewQuest() {
    setPreview(generateRandomScore({ instrument, ...launchOptions }));
  }

  useEffect(() => {
    setPreview(generateRandomScore({ instrument, ...launchOptions }));
  }, [instrument]); // eslint-disable-line react-hooks/exhaustive-deps

  function startQuest() {
    sessionStorage.setItem(RANDOM_OPTIONS_KEY, JSON.stringify(launchOptions));
    navigate('/practice', {
      state: {
        randomSeed: Date.now(),
        randomOptions: launchOptions,
      },
    });
  }

  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">
      <div className="mb-8">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">Generator</p>
        <h1 className="font-header text-3xl md:text-4xl text-text-primary mb-2">
          Infinite Sight-Reading Quest
        </h1>
        <p className="text-text-muted font-body text-sm max-w-2xl">
          Every run creates brand-new notation for your selected instrument, renders it as real MusicXML,
          moves the amber cursor through it, and scores your pitch accuracy from the microphone.
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
    </div>
  );
}
