import { useEffect, useState } from 'react';

export type BrandTheme = 'green' | 'blue';

const THEME_STORAGE_KEY = 'horeb360_theme';

function readInitialTheme(): BrandTheme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'blue' ? 'blue' : 'green';
  } catch {
    return 'green';
  }
}

export function useBrandTheme() {
  const [theme, setTheme] = useState<BrandTheme>(readInitialTheme);

  useEffect(() => {
    if (theme === 'blue') {
      document.documentElement.dataset.theme = 'blue';
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota errors
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'green' ? 'blue' : 'green'));

  return { theme, toggleTheme };
}
