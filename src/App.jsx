import { Outlet } from 'react-router-dom';
import Navigation from './components/Navigation.jsx';

/**
 * Root layout: fixed sidebar (desktop) + bottom nav (mobile) + scrollable main content.
 */
export default function App() {
  return (
    <div className="flex min-h-screen bg-bg-deep">
      <Navigation />
      <main className="flex-1 md:ml-20 pb-20 md:pb-0 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
