import { Link } from 'react-router-dom';

import { AuthLayout } from '../components/layout/AuthLayout.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';

// M11 renders the structural shell only — form submission, validation, and
// the actual POST /auth/login call are M12's job (PROJECT_SPEC.md M12
// task 2). This gives M12 a real page to wire up rather than a blank file.
export function LoginPage() {
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back — enter your details to continue."
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link to="/register" className="font-medium text-accent hover:text-accent-strong">
            Create one
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <Button type="submit" className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
