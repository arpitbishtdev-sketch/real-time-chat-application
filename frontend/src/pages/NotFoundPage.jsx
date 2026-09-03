import { useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button.jsx';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
      <p className="text-xl font-semibold text-ink">Page not found</p>
      <p className="max-w-sm text-sm text-ink-muted">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <Button className="mt-2" onClick={() => navigate('/')}>
        Go home
      </Button>
    </div>
  );
}
