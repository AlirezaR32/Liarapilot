'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { LpToaster } from '@/components/liarapilot/rtl-toaster';

// Radix primitives (ScrollArea, Select, Dialog, Popover, Collapsible…) take
// their direction from DirectionProvider — NOT from html[dir]. Without this,
// everything inside the main ScrollArea lays out LTR even in Persian, breaking
// the RTL experience. Mirroring the locale here fixes the whole tree at once.
function Runtime({ children }: { children: React.ReactNode }) {
  const { dir } = useI18n();
  return (
    <DirectionProvider dir={dir}>
      {children}
      <LpToaster />
    </DirectionProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 3000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Runtime>{children}</Runtime>
      </I18nProvider>
    </QueryClientProvider>
  );
}
