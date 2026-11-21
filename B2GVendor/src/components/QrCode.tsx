'use client';

import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// A QR code drawn as an inline SVG, entirely in the browser: the text (for two-step
// sign-in, the otpauth:// link that holds the secret) is never sent to any other
// site, which is why this is not a call to an image service.
//
// Built as SVG elements rather than an HTML string, so nothing is injected into the
// page. One path holds every dark module; four modules of empty border (the "quiet
// zone" scanners need) surround it.

const QUIET_ZONE = 4;

export function QrCode({ value, label, size = 192 }: { value: string; label: string; size?: number }) {
  const drawing = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value, 'Byte');
    code.make();
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) path += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { path, extent: count + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawing.extent} ${drawing.extent}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-xl border border-slate-200 bg-white"
    >
      <rect width={drawing.extent} height={drawing.extent} fill="#ffffff" />
      <path d={drawing.path} fill="#0f172a" />
    </svg>
  );
}
