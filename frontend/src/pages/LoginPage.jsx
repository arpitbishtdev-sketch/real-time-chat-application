import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { AuthLayout } from '../components/layout/AuthLayout.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuthStore } from '../store/authStore.js';
import { validateEmail, validateLoginPassword } from '../utils/authValidation.js';
import { fieldErrorsFromApiError, formErrorFromApiError } from '../utils/apiErrors.js';

// PROJECT_SPEC.md M12 task 2. RequireGuest (routes/RequireGuest.jsx) already
// redirects an authenticated visitor away from this route — this component
// only has to handle getting from "guest" to "authenticated" and, unlike
// RequireGuest's blanket redirect-to-'/', restores the page the visitor was
// actually trying to reach when RequireAuth first sent them here (its
// `state: { from: location }`, see routes/RequireAuth.jsx).
export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    if (formError) setFormError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = {
      email: validateEmail(values.email),
      password: validateLoginPassword(values.password),
    };
    if (validationErrors.email || validationErrors.password) {
      setFieldErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await login({ email: values.email.trim(), password: values.password });
      const redirectTo = location.state?.from
        ? `${location.state.from.pathname}${location.state.from.search ?? ''}`
        : '/';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setFieldErrors(fieldErrorsFromApiError(err));
      setFormError(formErrorFromApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

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
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={handleChange}
          error={fieldErrors.email}
          disabled={submitting}
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={values.password}
          onChange={handleChange}
          error={fieldErrors.password}
          disabled={submitting}
        />
        <Button type="submit" className="mt-1 w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
