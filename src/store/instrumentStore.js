import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { INSTRUMENT_RANGES } from '../utils/musicTheory.js';

/**
 * Global instrument state — persisted to localStorage.
 * Changing the instrument instantly:
 *   • Shifts the pitch-detection frequency window in the audio engine
 *   • Updates the open-string reference in the Tuner
 *   • Adjusts the default practice range in Practice
 */
export const useInstrumentStore = create(
  persist(
    (set, get) => ({
      instrument: 'violin',
      setInstrument: (instrument) => set({ instrument }),
      range: () => INSTRUMENT_RANGES[get().instrument],
    }),
    { name: 'vc-instrument' }
  )
);
