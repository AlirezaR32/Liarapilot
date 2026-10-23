'use client';

// RTL-aware toast host: mirrors the toast position (bottom-right → bottom-left)
// and feeds sonner the current direction so its slide/swipe animations match.
import { Toaster } from '@/components/ui/sonner';
import { useI18n } from '@/lib/i18n';

export function LpToaster() {
  const { dir } = useI18n();
  return (
    <Toaster
      dir={dir}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      richColors
    />
  );
}
