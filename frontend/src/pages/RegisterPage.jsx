import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { AuthLayout } from '../components/layout/AuthLayout.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuthStore } from '../store/authStore.js';
import { validateDisplayName, validateEmail, validateNewPassword } from '../utils/authValidation.js';
import { fieldErrorsFromApiError, formErrorFromApiError } from '../utils/apiErrors.js';

// PROJECT_SPEC.md M12 task 1 — mirrors LoginPage.jsx's shape (same
// validate-then-submit-then-redirect pattern) but validates the
// registration-specific fields (displayName, and the length-checked new
// password rather than login's presence-only check).
export function RegisterPage() {
  const register = useAuthStore((state) => state.register);
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ displayName: '', email: '', password: '' });
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
      displayName: validateDisplayName(values.displayName),
      email: validateEmail(values.email),
      password: validateNewPassword(values.password),
    };
    if (validationErrors.displayName || validationErrors.email || validationErrors.password) {
      setFieldErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await register({
        displayName: values.displayName.trim(),
        email: values.email.trim(),
        password: values.password,
      });
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
          label="Display name"
          name="displayName"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={values.displayName}
          onChange={handleChange}
          error={fieldErrors.displayName}
          disabled={submitting}
        />
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
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={values.password}
          onChange={handleChange}
          error={fieldErrors.password}
          disabled={submitting}
        />
        <Button type="submit" className="mt-1 w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
