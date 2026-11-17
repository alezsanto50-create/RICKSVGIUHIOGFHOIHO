import React from 'react';
import { Download } from 'lucide-react';
import primaryLogo from '../assets/images/trindade_primary_logo_1794783377164.jpg';
import circularBadge from '../assets/images/trindade_signature_crest_hero_1794821003049.jpg';
import iconMark from '../assets/images/trindade_icon_mark_1794783378015.jpg';
import horizontalLockup from '../assets/images/trindade_horizontal_lockup_1794783378606.jpg';

const ORIGINAL_CREST_URL = '/assets/aistudio/WhatsApp_Image_2026-11-15_at_19.46.20_ac7c27d9.jpeg';

interface BrandAsset {
  id: string;
  title: string;
  usage: string;
  src: string;
  filename: string;
  aspect: 'square' | 'wide';
  circlePreview?: boolean;
}

const BRAND_ASSETS: BrandAsset[] = [
  {
    id: 'primary',
    title: 'Logo Principal (Ouro & Ônix)',
    usage: 'Apresentação comercial, materiais impressos e destaque institucional',
    src: primaryLogo,
    filename: 'barbearia-trindade-logo-principal.jpg',
    aspect: 'square',
  },
  {
    id: 'circular',
    title: 'Brasão Oficial Ouro 24k (App & Redes)',
    usage: 'Logo principal do sistema, WhatsApp Business, Instagram e atalhos',
    src: circularBadge,
    filename: 'barbearia-trindade-brasao-ouro.jpg',
    aspect: 'square',
    circlePreview: true,
  },
  {
    id: 'icon',
    title: 'Ícone Simplificado (Marca & Favicon)',
    usage: 'Cabeçalho mobile, ícone de atalho e favicon',
    src: iconMark,
    filename: 'barbearia-trindade-icone-app.jpg',
    aspect: 'square',
  },
  {
    id: 'horizontal',
    title: 'Assinatura Horizontal (Fachada & Recibos)',
    usage: 'Cabeçalho de relatórios PDF, fachada, cartão de visita e comprovantes',
    src: horizontalLockup,
    filename: 'barbearia-trindade-horizontal.jpg',
    aspect: 'wide',
  },
  {
    id: 'original',
    title: 'Brasão Original (2018)',
    usage: 'Matriz monocromática original enviada pelo proprietário',
    src: ORIGINAL_CREST_URL,
    filename: 'barbearia-trindade-original-2018.jpeg',
    aspect: 'square',
  },
];

export const BrandSuitePanel: React.FC = () => {
  const handleDownload = (asset: BrandAsset) => {
    const a = document.createElement('a');
    a.href = asset.src;
    a.download = asset.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[22px] apple-glass p-5">
        <h3 className="text-base font-bold text-white">Suíte de Identidade Visual — Barbearia Trindade</h3>
        <p className="text-xs text-zinc-400 mt-1">
          Variações oficiais em preto fosco, cinza grafite e ouro metálico baseadas no brasão de 2018. Baixe os arquivos para WhatsApp, Instagram, fachada e recibos.
        </p>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {BRAND_ASSETS.map((asset) => (
            <div
              key={asset.id}
              className={`rounded-[20px] apple-glass-well p-4 flex flex-col justify-between gap-4 ${
                asset.aspect === 'wide' ? 'md:col-span-2' : ''
              }`}
            >
              <div>
                <div
                  className={`overflow-hidden rounded-2xl border border-white/[0.08] bg-black flex items-center justify-center ${
                    asset.aspect === 'wide' ? 'aspect-video' : 'aspect-square'
                  }`}
                >
                  <img
                    src={asset.src}
                    alt={asset.title}
                    referrerPolicy="no-referrer"
                    className={`w-full h-full ${
                      asset.circlePreview ? 'object-cover rounded-full p-2' : 'object-contain'
                    }`}
                  />
                </div>
                <h4 className="mt-3 text-sm font-bold text-white">{asset.title}</h4>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{asset.usage}</p>
              </div>

              <button
                type="button"
                onClick={() => handleDownload(asset)}
                className="w-full min-h-[44px] rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/12 text-[#E6C65C] text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[#D4AF37]/20 transition-colors"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Baixar Arquivo</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
