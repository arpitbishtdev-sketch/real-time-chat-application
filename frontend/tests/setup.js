import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia — useTheme.js (system-preference
// detection) needs it. Defaults to "no preference matched" (light theme),
// which is what every test that doesn't care about theme wants.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
