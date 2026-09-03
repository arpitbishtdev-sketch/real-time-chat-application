import { Link } from 'react-router-dom';

import { AuthLayout } from '../components/layout/AuthLayout.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';

// Structural shell only — see LoginPage.jsx's note. Real submission is
// M12 task 1.
export function RegisterPage() {
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start chatting in a couple of minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:text-accent-strong">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
        <Input
          label="Display name"
          name="displayName"
          autoComplete="name"
          placeholder="Ada Lovelace"
        />
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
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <Button type="submit" className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
