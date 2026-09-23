/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small head-photo thumbnail used across the identities UI: shows the first
 * verified face crop when an identity has one, and falls back to the person's
 * initials otherwise (they may not have an ID photo in the corpus yet).
 */

import React from 'react';

interface FaceThumbProps {
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
  rounded?: boolean;
}

export const FaceThumb: React.FC<FaceThumbProps> = ({ url, name, size = 40, className = '', rounded = true }) => {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  const style = { width: size, height: size };
  const shape = rounded ? 'rounded-full' : 'rounded-lg';
  if (url) {
    return (
      <img
        src={url}
        alt={`${name} head photo`}
        title={`${name} head photo`}
        style={style}
        className={`${className} ${shape} object-cover shrink-0 bg-black/40 border border-matrix-500/25`}
      />
    );
  }
  return (
    <div
      style={style}
      title={`${name} (no head photo yet)`}
      className={`${className} ${shape} shrink-0 flex items-center justify-center bg-matrix-950/60 border border-matrix-500/20 font-mono font-bold text-matrix-400 text-xs select-none`}
    >
      {initials}
    </div>
  );
};