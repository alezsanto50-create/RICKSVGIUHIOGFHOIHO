import React, { useState } from 'react';
import emblemBadgeImg from '../assets/images/trindade_emblem_badge.png';

interface BrandMarkProps {
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = 'w-10 h-10' }) => {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="#121216" stroke="#D4AF37" strokeOpacity="0.6" strokeWidth="2" />
        <path
          d="M17 24L22.5 14.5L32 21.5L41.5 14.5L47 24H17Z"
          stroke="#D4AF37"
          strokeWidth="2.4"
          strokeLinejoin="round"
          fill="#D4AF37"
          fillOpacity="0.16"
        />
        <path d="M20 30H44" stroke="#E6C65C" strokeWidth="3" strokeLinecap="round" />
        <path d="M32 30V50" stroke="#E6C65C" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <img
      src={emblemBadgeImg}
      alt="Barbearia Trindade"
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className={`${className} rounded-full object-contain shrink-0 select-none`}
    />
  );
};
