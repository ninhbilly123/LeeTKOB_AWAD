import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RouterContext, useRouter } from './router-core';

interface RouterProviderProps {
  initialPath?: string;
  children: React.ReactNode;
}

function parseLocation(pathWithSearch: string): { pathname: string; search: string } {
  const [pathnameRaw, searchRaw] = pathWithSearch.split('?');
  return {
    pathname: pathnameRaw || '/',
    search: searchRaw ? `?${searchRaw}` : '',
  };
}

export function RouterProvider({ initialPath, children }: RouterProviderProps) {
  const isMemoryMode = initialPath !== undefined;
  const [location, setLocation] = useState<{ pathname: string; search: string }>(() =>
    isMemoryMode
      ? parseLocation(initialPath)
      : {
          pathname: window.location.pathname || '/',
          search: window.location.search || '',
        },
  );

  useEffect(() => {
    if (isMemoryMode) return;
    const onPopState = () => {
      setLocation({
        pathname: window.location.pathname || '/',
        search: window.location.search || '',
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isMemoryMode]);

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      const next = parseLocation(to);
      if (!isMemoryMode) {
        if (options?.replace) {
          window.history.replaceState({}, '', to);
        } else {
          window.history.pushState({}, '', to);
        }
      }
      setLocation(next);
    },
    [isMemoryMode],
  );

  const value = useMemo(
    () => ({
      pathname: location.pathname,
      search: location.search,
      navigate,
    }),
    [location, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    onClick?.(event);
    navigate(to);
  };

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
