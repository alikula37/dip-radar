import type { Coin, DipHistoryPoint } from '@/types';

/**
 * Share cards: a 1200x675 (X/Twitter-friendly) SVG rendered to PNG, plus
 * ready-to-post copy. The card is built as an SVG string so the design is fully
 * deterministic and reuses the same serialize-and-download pipeline as the
 * chart exports.
 */

const WIDTH = 1200;
const HEIGHT = 675;
const BG = '#12100b';
const PANEL = '#1c1912';
const OUTLINE = '#4d4533';
const TEXT = '#f1e8d7';
const MUTED = '#b3a68c';
const ACCENT = '#e8b64c';
const GREEN = '#7ec96f';
const RED = '#e07a6b';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
  return value.toPrecision(4);
}

function scoreLabel(score: number): string {
  if (score >= 95) return 'cheapest 5% of tracked alts';
  if (score >= 80) return 'cheapest 20% of tracked alts';
  if (score >= 50) return 'cheaper than the median alt';
  if (score >= 20) return 'expensive half of the universe';
  return 'among the most expensive alts';
}

function sparklinePath(points: number[], x: number, y: number, width: number, height: number): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  return points
    .map((value, index) => {
      const px = x + index * step;
      const py = y + height - ((value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

function metricBox(
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  detail: string,
  tone = TEXT,
): string {
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${width}" height="86" rx="12" fill="${PANEL}" stroke="${OUTLINE}" stroke-width="1"/>
      <text x="18" y="28" fill="${MUTED}" font-size="16" font-family="Inter, sans-serif">${escapeXml(label)}</text>
      <text x="18" y="60" fill="${tone}" font-size="30" font-weight="600" font-family="Inter, sans-serif">${escapeXml(value)}</text>
      <text x="18" y="80" fill="${MUTED}" font-size="14" font-family="Inter, sans-serif">${escapeXml(detail)}</text>
    </g>`;
}

function footer(dateLabel: string): string {
  return `
    <text x="64" y="${HEIGHT - 34}" fill="${MUTED}" font-size="16" font-family="Inter, sans-serif">
      Dip Radar · BTC-parity altcoin analytics · ${escapeXml(dateLabel)} · not financial advice
    </text>
    <text x="${WIDTH - 64}" y="${HEIGHT - 34}" fill="${ACCENT}" font-size="16" text-anchor="end" font-family="Inter, sans-serif">
      github.com/alikula37/dip-radar
    </text>`;
}

function frame(title: string, subtitle: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1c1912" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="150" fill="url(#glow)"/>
  <g transform="translate(64, 66)">
    <text x="0" y="0" fill="${ACCENT}" font-size="26" font-weight="700" font-family="Inter, sans-serif">DIP RADAR</text>
    <text x="0" y="30" fill="${MUTED}" font-size="17" font-family="Inter, sans-serif">${escapeXml(subtitle)}</text>
  </g>
  <text x="${WIDTH - 64}" y="66" fill="${TEXT}" font-size="26" font-weight="600" text-anchor="end" font-family="Inter, sans-serif">${escapeXml(title)}</text>`;
}

export interface CoinCardOptions {
  dateLabel: string;
  referenceLabel?: string;
  dipHistory?: DipHistoryPoint[];
  priceUsd?: number | null;
  priceBtc?: number | null;
}

export function buildCoinCardSvg(coin: Coin, options: CoinCardOptions): string {
  const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
  const score = coin.value_score ?? null;
  const distance = coin.distance_pct_event;
  const trend7 = coin.price_7d_ago_btc
    ? ((coin.current_price_btc ?? 0) / coin.price_7d_ago_btc - 1) * 100
    : null;
  const trendColor = (trend7 ?? 0) >= 0 ? GREEN : RED;
  const spark = (options.dipHistory ?? []).map((point) => point.distance_pct_event);

  return `${frame(`$${symbol}`, `Altcoin report card · ${options.dateLabel}`)}
  <g transform="translate(64, 150)">
    <text x="0" y="0" fill="${TEXT}" font-size="40" font-weight="600" font-family="Inter, sans-serif">${escapeXml(coin.name ?? symbol)}</text>
    <text x="0" y="34" fill="${MUTED}" font-size="20" font-family="Inter, sans-serif">measured in BTC parity${coin.valuation_pct_3y !== null && coin.valuation_pct_3y !== undefined ? ` · since ${coin.history_days ?? '—'} days of history` : ''}</text>
  </g>

  <g transform="translate(64, 220)">
    <rect width="330" height="150" rx="16" fill="${PANEL}" stroke="${ACCENT}" stroke-width="2"/>
    <text x="22" y="36" fill="${MUTED}" font-size="16" font-family="Inter, sans-serif">VALUE SCORE</text>
    <text x="22" y="100" fill="${ACCENT}" font-size="64" font-weight="700" font-family="Inter, sans-serif">${score === null ? '—' : Math.round(score)}</text>
    <text x="22" y="132" fill="${MUTED}" font-size="15" font-family="Inter, sans-serif">${score === null ? 'not enough history' : scoreLabel(score)}</text>
  </g>

  <g transform="translate(420, 220)">
    <text x="0" y="26" fill="${MUTED}" font-size="16" font-family="Inter, sans-serif">PRICE</text>
    <text x="0" y="70" fill="${TEXT}" font-size="40" font-weight="600" font-family="Inter, sans-serif">$${price(options.priceUsd ?? coin.current_price_usd)}</text>
    <text x="0" y="104" fill="${MUTED}" font-size="18" font-family="Inter, sans-serif">${price(options.priceBtc ?? coin.current_price_btc)} BTC</text>
    <text x="0" y="138" fill="${trendColor}" font-size="20" font-family="Inter, sans-serif">${pct(trend7)} 7d · market cap ${compact(coin.market_cap)}</text>
  </g>

  ${metricBox(64, 400, 250, 'FROM ITS DIP', pct(distance, 1), options.referenceLabel ?? 'Since 2021 low')}
  ${metricBox(330, 400, 250, '3Y VALUATION', coin.valuation_pct_3y !== null && coin.valuation_pct_3y !== undefined ? `P${Math.round(coin.valuation_pct_3y)}` : '—', 'share of days above today')}
  ${metricBox(596, 400, 250, '3Y RANGE', coin.range_position !== null && coin.range_position !== undefined ? `${Math.round(coin.range_position * 100)}%` : '—', 'ATL 0% → ATH 100%')}
  ${metricBox(862, 400, 274, 'DIP RESPECT', coin.dip_bounces ? `${coin.dip_bounces}×` : '0×', coin.dip_bounce_avg ? `avg bounce ${pct(coin.dip_bounce_avg, 0)}` : 'no proven bounce yet')}
  ${metricBox(64, 500, 250, 'BASING (90D)', coin.basing_pct_90d !== null && coin.basing_pct_90d !== undefined ? `${Math.round(coin.basing_pct_90d)}%` : '—', 'days in the bottom quartile')}
  ${metricBox(330, 500, 250, 'MEDIAN GAP', coin.median_dist_3y !== null && coin.median_dist_3y !== undefined ? pct(coin.median_dist_3y, 0) : '—', 'vs the 3y median close')}
  <g transform="translate(596, 500)">
    <rect width="540" height="86" rx="12" fill="${PANEL}" stroke="${OUTLINE}" stroke-width="1"/>
    <text x="18" y="26" fill="${MUTED}" font-size="15" font-family="Inter, sans-serif">DISTANCE FROM DIP · 1Y</text>
    <path d="${sparklinePath(spark, 18, 36, 504, 38)}" fill="none" stroke="${GREEN}" stroke-width="2"/>
  </g>
  ${footer(options.dateLabel)}
</svg>`;
}

export interface DigestCardOptions {
  dateLabel: string;
  subtitle?: string;
}

export function buildDigestCardSvg(coins: Coin[], options: DigestCardOptions): string {
  const columns = `
    <g transform="translate(64, 240)" font-family="Inter, sans-serif" font-size="14" fill="${MUTED}" letter-spacing="1">
      <text x="0" y="0">#</text>
      <text x="290" y="0">SCORE</text>
      <text x="430" y="0">FROM DIP</text>
      <text x="700" y="0">7D</text>
      <text x="${WIDTH - 128}" y="0" text-anchor="end">DIP BOUNCES</text>
    </g>`;

  const rows = coins.slice(0, 5).map((coin, index) => {
    const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
    const trend7 = coin.price_7d_ago_btc
      ? ((coin.current_price_btc ?? 0) / coin.price_7d_ago_btc - 1) * 100
      : null;
    const y = 272 + index * 68;
    const name = symbol.length > 7 ? `${symbol.slice(0, 6)}…` : symbol;
    return `
      <g transform="translate(64, ${y})">
        <text x="0" y="32" fill="${MUTED}" font-size="26" font-family="Inter, sans-serif">${index + 1}</text>
        <text x="42" y="32" fill="${TEXT}" font-size="30" font-weight="600" font-family="Inter, sans-serif">$${escapeXml(name)}</text>
        <text x="290" y="32" fill="${ACCENT}" font-size="30" font-weight="700" font-family="Inter, sans-serif">${coin.value_score === null || coin.value_score === undefined ? '—' : Math.round(coin.value_score)}</text>
        <text x="430" y="32" fill="${TEXT}" font-size="26" font-family="Inter, sans-serif">${pct(coin.distance_pct_event, 1)}</text>
        <text x="700" y="32" fill="${(trend7 ?? 0) >= 0 ? GREEN : RED}" font-size="26" font-family="Inter, sans-serif">${pct(trend7, 1)}</text>
        <text x="${WIDTH - 128}" y="32" fill="${MUTED}" font-size="24" text-anchor="end" font-family="Inter, sans-serif">${coin.dip_bounces ? `${coin.dip_bounces}×` : '—'}</text>
        <line x1="0" y1="48" x2="${WIDTH - 128}" y2="48" stroke="${OUTLINE}" stroke-width="1" opacity="0.5"/>
      </g>`;
  });

  return `${frame('Daily board', options.subtitle ?? 'Cheapest tracked altcoins · BTC parity')}
  <g transform="translate(64, 186)">
    <text x="0" y="0" fill="${MUTED}" font-size="18" font-family="Inter, sans-serif">Ranked by the Value Score (0-100 percentile of cheapness vs each coin&apos;s own history, dip respect included)</text>
  </g>
  ${columns}
  ${rows.join('')}
  ${footer(options.dateLabel)}
</svg>`;
}

export async function downloadSvgAsPng(svg: string, filename: string): Promise<void> {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas is not supported'));
        return;
      }
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG export failed'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        resolve();
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('PNG export failed'));
    image.src = dataUrl;
  });
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

export function coinTweetText(coin: Coin): string {
  const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
  const score = coin.value_score !== null && coin.value_score !== undefined ? Math.round(coin.value_score) : null;
  const trend7 = coin.price_7d_ago_btc
    ? ((coin.current_price_btc ?? 0) / coin.price_7d_ago_btc - 1) * 100
    : null;
  const lines = [
    score !== null ? `🎯 $${symbol} · Value Score ${score}/100 (${scoreLabel(score)})` : `🎯 $${symbol} · not enough history for a score yet`,
    `📉 ${pct(coin.distance_pct_event, 1)} from its reference dip low`,
    coin.valuation_pct_3y !== null && coin.valuation_pct_3y !== undefined
      ? `📊 3y valuation P${Math.round(coin.valuation_pct_3y)} · range ${coin.range_position !== null && coin.range_position !== undefined ? Math.round(coin.range_position * 100) : '—'}% · basing ${coin.basing_pct_90d !== null && coin.basing_pct_90d !== undefined ? Math.round(coin.basing_pct_90d) : '—'}%`
      : '📊 3y valuation not available (new listing)',
    coin.dip_bounces
      ? `🧱 Dip respect: ${coin.dip_bounces} proven bounces${coin.dip_bounce_avg ? `, avg +${Math.round(coin.dip_bounce_avg)}%` : ''}`
      : '🧱 No proven bounce from this dip yet',
    `💵 $${price(coin.current_price_usd)} · ${price(coin.current_price_btc)} BTC · ${pct(trend7, 1)} 7d`,
    '#crypto #altcoins #BTC',
  ];
  return lines.join('\n');
}

export function digestTweetText(coins: Coin[], dateLabel: string): string {
  const lines = coins.slice(0, 5).map((coin, index) => {
    const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
    const score = coin.value_score !== null && coin.value_score !== undefined ? Math.round(coin.value_score) : '—';
    const trend7 = coin.price_7d_ago_btc
      ? ((coin.current_price_btc ?? 0) / coin.price_7d_ago_btc - 1) * 100
      : null;
    return `${index + 1}. $${symbol} · score ${score} · ${pct(coin.distance_pct_event, 1)} from dip · ${pct(trend7, 1)} 7d${coin.dip_bounces ? ` · ${coin.dip_bounces}× dip bounce` : ''}`;
  });
  return [`🎯 Dip Radar daily board · ${dateLabel}`, 'Cheapest tracked altcoins vs their own history (BTC parity):', ...lines, '', '#crypto #altcoins #BTC'].join('\n');
}
