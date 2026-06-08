# Milestone 7: Auth, Offline & Polish

## Goal

Add Supabase authentication, offline support with service workers, handle AudioContext edge cases, and polish the app for production readiness.

## Scope

- Supabase authentication (Google/Apple OAuth)
- Service worker for offline caching
- AudioContext suspension edge cases
- Data sync between offline and online states
- Final polish and production build verification

---

### Task 1: Supabase Authentication

**Description**: Integrate Supabase for user authentication with Google and Apple OAuth, protecting practice data and enabling cross-device sync.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Install Supabase client: `npm install @supabase/supabase-js`
3. Create `src/lib/supabase.js`:
   - Initialize Supabase client with environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
   - Export typed client instance
4. Create `src/hooks/useAuth.js`:
   - `signInWithGoogle()`, `signInWithApple()`, `signOut()`
   - Track auth state: `{ user, isLoading, isAuthenticated }`
   - Listen to auth state changes via `onAuthStateChange`
5. Create `src/pages/Login.jsx`:
   - Centered login card with Midnight Conservatory styling
   - App logo/title, "Sign in with Google" and "Sign in with Apple" buttons
   - Loading state during auth redirect
6. Create `src/components/AuthGuard.jsx`:
   - Wrapper component that redirects unauthenticated users to `/login`
   - Shows loading spinner while checking auth state
7. Add `/login` route and wrap protected routes with AuthGuard
8. Add `.env.example` with required Supabase environment variables (no real keys)
9. Update session history to associate with authenticated user ID

**Acceptance criteria**:
- Google and Apple OAuth flows work end-to-end
- Unauthenticated users are redirected to login
- Auth state persists across page reloads
- User ID is associated with session data
- Environment variables documented in `.env.example`

**Dependencies**: Milestone 1 (all tasks)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: Offline Caching & Sync

**Description**: Implement a service worker that caches the music library and app shell for offline use, and syncs DSP/session data when connectivity returns.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Install Workbox for service worker tooling: `npm install -D workbox-webpack-plugins` or use Vite PWA plugin (`npm install -D vite-plugin-pwa`)
3. Configure service worker with caching strategies:
   - App shell (HTML, JS, CSS): Cache-first
   - Music library (MusicXML files from IndexedDB): already local, ensure persistence
   - Google Fonts: Stale-while-revalidate
   - LLM API calls: Network-only (no caching of AI responses)
4. Create `src/lib/syncManager.js`:
   - Queue session data that could not be synced while offline
   - On connectivity restore (`navigator.onLine` event), flush queue to Supabase
   - Handle conflicts: last-write-wins for session data
5. Update `useAudioStore` and session history to work fully offline:
   - All DSP processing is local (already works offline)
   - Session saves go to IndexedDB first, sync to Supabase when online
6. Add offline indicator in the UI: subtle chip in the header when offline
7. Test: disable network, verify practice flow works completely, re-enable and verify sync

**Acceptance criteria**:
- App loads and functions fully offline after first visit
- Music library accessible offline
- Practice sessions save locally and sync when online
- Offline indicator visible when disconnected
- No data loss during offline-to-online transitions

**Dependencies**: Task 1 (Supabase Auth), Milestone 6 (Session History)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 3: AudioContext Edge Cases & Production Polish

**Description**: Handle all AudioContext edge cases, add production optimizations, and verify the complete application works end-to-end.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Update `src/lib/audioContext.js` to handle edge cases:
   - Browser tab goes to background: suspend AudioContext, resume on focus
   - Mobile browser interruption (phone call): detect and gracefully pause practice
   - AudioContext `close()` called accidentally: recreate on next practice start
   - Multiple rapid start/stop: debounce AudioContext operations
3. Add `visibilitychange` event listener to pause/resume audio pipeline
4. Verify latency budget:
   - Measure actual mic-to-UI latency using `performance.now()` timestamps
   - Log latency metrics to console in development mode
   - Add a latency warning if >30ms detected
5. Production build verification:
   - Run `npm run build` and verify clean output
   - Test production build with `npm run preview`
   - Verify all routes work, no console errors
   - Verify service worker registers correctly
6. Add error boundary component at app root to catch and display runtime errors gracefully
7. Verify all Golden Rules one final time:
   - No `tailwind.config.js` file exists
   - Zero inline hex codes in any component (grep the codebase)
   - All SVG/img/canvas have dimension constraints
   - All work is in the correct repository

**Acceptance criteria**:
- AudioContext handles all suspension/resumption edge cases
- Tab backgrounding pauses audio cleanly
- Production build succeeds with no warnings
- Latency remains <30ms in production build
- Error boundary catches and displays errors gracefully
- All Golden Rules pass verification

**Dependencies**: All previous milestones

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
