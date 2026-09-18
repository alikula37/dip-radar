import type { Coin, DipHistoryPoint } from '@/types';

/**
 * Share cards for X/Twitter: a 1080x1350 (4:5) SVG rendered to PNG with
 * ready-to-post copy. The design is deliberately hierarchical — one giant
 * Value Score + verdict as the hook, one annotated evidence chart, three large
 * stats — and keeps a 24px type floor so it stays readable at feed size.
 */

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 72;
const CONTENT = WIDTH - MARGIN * 2;

const BG = '#12100b';
const PANEL = '#1c1912';
const HAIRLINE = '#4d4533';
const TEXT = '#f1e8d7';
const MUTED = '#b3a68c';
const ACCENT = '#e8b64c';
const GREEN = '#7ec96f';
const RED = '#e07a6b';

/**
 * Optional watermark: set to your X handle (e.g. '@DipRadar') to sign the cards.
 * Left empty the footer stays clean — no URLs or handles are added by default.
 */
export const SHARE_HANDLE = '';

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

function scoreVerdict(score: number | null): string {
  if (score === null) return 'NOT ENOUGH HISTORY FOR A SCORE YET';
  if (score >= 95) return 'CHEAPEST 5% OF TRACKED ALTS';
  if (score >= 80) return 'CHEAPEST 20% OF TRACKED ALTS';
  if (score >= 50) return 'CHEAPER THAN THE MEDIAN ALT';
  if (score >= 20) return 'EXPENSIVE HALF OF TRACKED ALTS';
  return 'AMONG THE MOST EXPENSIVE ALTS';
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function dateSlug(label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(label);
  if (!match) return label.toUpperCase();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function header(dateLabel: string): string {
  return `
  <text x="${MARGIN}" y="92" fill="${ACCENT}" font-size="36" font-weight="800" letter-spacing="3" font-family="Inter, sans-serif">DIP RADAR</text>
  <text x="${WIDTH - MARGIN}" y="92" fill="${MUTED}" font-size="28" font-weight="500" text-anchor="end" font-family="Inter, sans-serif">${escapeXml(dateSlug(dateLabel))}</text>
  <line x1="${MARGIN}" y1="122" x2="${WIDTH - MARGIN}" y2="122" stroke="${HAIRLINE}" stroke-width="1" opacity="0.4"/>`;
}

function footer(dateLabel: string): string {
  return `
  <line x1="${MARGIN}" y1="1250" x2="${WIDTH - MARGIN}" y2="1250" stroke="${HAIRLINE}" stroke-width="1" opacity="0.4"/>
  <text x="${MARGIN}" y="1292" fill="${MUTED}" font-size="24" font-weight="500" font-family="Inter, sans-serif">BTC-parity analytics · not financial advice</text>
  ${SHARE_HANDLE ? `<text x="${WIDTH - MARGIN}" y="1292" fill="${MUTED}" font-size="24" font-weight="600" text-anchor="end" font-family="Inter, sans-serif">${escapeXml(SHARE_HANDLE)}</text>` : ''}`;
}

interface ChartPoint {
  x: number;
  y: number;
}

function chartGeometry(history: DipHistoryPoint[]) {
  const plotX = 130;
  const plotY = 790;
  const plotW = WIDTH - MARGIN - plotX;
  const plotH = 220;

  const values = history.map((point) => point.distance_pct_event);
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const domain = Math.max(max * 1.1, 30);
  const step = plotW / (values.length - 1);
  const points: ChartPoint[] = values.map((value, index) => ({
    x: plotX + index * step,
    y: plotY + plotH - (value / domain) * plotH,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');
  const dipY = plotY + plotH - (15 / domain) * plotH;

  // Dip-zone visits: entries into the ≤15% zone that later rally ≥30% before
  // the next entry — the same shape as the Value Score's dip-respect feature.
  const visits: ChartPoint[] = [];
  let index = 0;
  while (index < values.length) {
    if (values[index] <= 15) {
      const start = index;
      let peak = values[index];
      let cursor = index;
      while (cursor < values.length && values[cursor] <= 15) cursor += 1;
      const windowEnd = Math.min(values.length, start + 180);
      for (let scan = start; scan < windowEnd; scan += 1) peak = Math.max(peak, values[scan]);
      if (peak >= 30) visits.push(points[start]);
      index = Math.max(cursor, start + 45);
    } else {
      index += 1;
    }
  }

  return { plotX, plotY, plotW, plotH, domain, path, dipY, visits, last: points[points.length - 1], start: history[0] };
}

function evidencePanel(history: DipHistoryPoint[]): string {
  const geometry = chartGeometry(history);
  const title = `
    <text x="${MARGIN + 24}" y="756" fill="${MUTED}" font-size="24" font-weight="600" letter-spacing="1" font-family="Inter, sans-serif">DISTANCE FROM DIP · 3Y</text>`;
  if (!geometry) {
    return `
  <rect x="${MARGIN}" y="720" width="${CONTENT}" height="370" rx="20" fill="${PANEL}" stroke="${HAIRLINE}" stroke-width="1"/>
  ${title}
  <text x="${MARGIN + 24}" y="900" fill="${MUTED}" font-size="26" font-family="Inter, sans-serif">Not enough history for this chart yet.</text>`;
  }
  const { plotX, plotY, plotW, plotH, domain, path, dipY, visits, last, start } = geometry;
  const step = [5, 10, 20, 25, 50, 100, 200, 500, 1000].find((candidate) => domain / candidate <= 5) ?? 1000;
  const gridlines = [];
  for (let value = 0; value <= domain; value += step) {
    const y = plotY + plotH - (value / domain) * plotH;
    gridlines.push(`
      <line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotW}" y2="${y.toFixed(1)}" stroke="${HAIRLINE}" stroke-width="1" opacity="0.25"/>
      <text x="${plotX - 14}" y="${(y + 8).toFixed(1)}" fill="${MUTED}" font-size="22" text-anchor="end" font-family="Inter, sans-serif">+${value}%</text>`);
  }
  const dots = visits
    .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="9" fill="${GREEN}"/>`)
    .join('');
  const startDate = start.timestamp.slice(0, 10);
  const midDate = [...history][Math.floor(history.length / 2)]?.timestamp.slice(0, 10) ?? '';
  return `
  <rect x="${MARGIN}" y="720" width="${CONTENT}" height="370" rx="20" fill="${PANEL}" stroke="${HAIRLINE}" stroke-width="1"/>
  ${title}
  <rect x="${plotX}" y="${dipY.toFixed(1)}" width="${plotW}" height="${(plotY + plotH - dipY).toFixed(1)}" fill="${GREEN}" opacity="0.08"/>
  <line x1="${plotX}" y1="${dipY.toFixed(1)}" x2="${plotX + plotW}" y2="${dipY.toFixed(1)}" stroke="${GREEN}" stroke-width="1.5" stroke-dasharray="6 6" opacity="0.7"/>
  ${gridlines.join('')}
  <path d="${path}" fill="none" stroke="${ACCENT}" stroke-width="3"/>
  ${dots}
  <line x1="${last.x.toFixed(1)}" y1="${plotY}" x2="${last.x.toFixed(1)}" y2="${plotY + plotH}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="6 6" opacity="0.8"/>
  <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="11" fill="${ACCENT}"/>
  <text x="${last.x - 16}" y="${(last.y - 26).toFixed(1)}" fill="${ACCENT}" font-size="24" font-weight="700" text-anchor="end" font-family="Inter, sans-serif">NOW ${pct(history[history.length - 1].distance_pct_event, 1)}</text>
  <text x="${plotX}" y="${plotY + plotH + 36}" fill="${MUTED}" font-size="22" font-family="Inter, sans-serif">${startDate}</text>
  <text x="${plotX + plotW / 2}" y="${plotY + plotH + 36}" fill="${MUTED}" font-size="22" text-anchor="middle" font-family="Inter, sans-serif">${midDate}</text>
  <text x="${plotX + plotW}" y="${plotY + plotH + 36}" fill="${MUTED}" font-size="22" text-anchor="end" font-family="Inter, sans-serif">now</text>
  <text x="${MARGIN + 24}" y="1074" fill="${MUTED}" font-size="22" font-family="Inter, sans-serif">shade = dip zone (≤15% above the low) · dots = visits that rallied ≥30%</text>`;
}

function statColumn(x: number, label: string, value: string, detail: string, tone = TEXT): string {
  return `
  <g transform="translate(${x}, 1130)">
    <text x="0" y="0" fill="${MUTED}" font-size="24" font-weight="600" letter-spacing="1" font-family="Inter, sans-serif">${escapeXml(label)}</text>
    <text x="0" y="68" fill="${tone}" font-size="58" font-weight="700" font-family="Inter, sans-serif">${escapeXml(value)}</text>
    <text x="0" y="104" fill="${MUTED}" font-size="24" font-family="Inter, sans-serif">${escapeXml(detail)}</text>
  </g>`;
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
  const identity = `$${symbol}${coin.name ? ` · ${coin.name}` : ''}`;
  const identityLabel = identity.length > 26 ? `${identity.slice(0, 25)}…` : identity;
  const score = coin.value_score ?? null;
  const scoreText = score === null ? '—' : String(Math.round(score));
  const trend7 = coin.price_7d_ago_btc
    ? ((coin.current_price_btc ?? 0) / coin.price_7d_ago_btc - 1) * 100
    : null;
  const trendColor = (trend7 ?? 0) >= 0 ? GREEN : RED;
  const verdictLines = wrap(scoreVerdict(score), 34);
  const rulerWidth = score === null ? 0 : Math.max(6, (score / 100) * CONTENT);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  ${header(options.dateLabel)}

  <text x="${MARGIN}" y="212" fill="${TEXT}" font-size="48" font-weight="700" font-family="Inter, sans-serif">${escapeXml(identityLabel)}</text>
  <text x="${WIDTH - MARGIN}" y="196" fill="${TEXT}" font-size="40" font-weight="700" text-anchor="end" font-family="Inter, sans-serif">$${price(options.priceUsd ?? coin.current_price_usd)}</text>
  <text x="${WIDTH - MARGIN}" y="232" fill="${MUTED}" font-size="24" text-anchor="end" font-family="Inter, sans-serif">${price(options.priceBtc ?? coin.current_price_btc)} BTC</text>
  <text x="${WIDTH - MARGIN}" y="264" fill="${trendColor}" font-size="24" text-anchor="end" font-family="Inter, sans-serif">${pct(trend7, 1)} 7d · market cap ${compact(coin.market_cap)}</text>

  <text x="${MARGIN}" y="352" fill="${MUTED}" font-size="26" font-weight="600" letter-spacing="2" font-family="Inter, sans-serif">VALUE SCORE</text>
  ${
    score === null
      ? `<text x="${MARGIN}" y="470" fill="${MUTED}" font-size="120" font-weight="800" font-family="Inter, sans-serif">N/A</text>
        <text x="${MARGIN + 320}" y="440" fill="${MUTED}" font-size="28" font-family="Inter, sans-serif">building a 3-year history</text>`
      : `<text x="${MARGIN}" y="480" fill="${ACCENT}" font-size="170" font-weight="800" font-family="Inter, sans-serif">${scoreText}</text>
        <text x="${MARGIN + 40 + scoreText.length * 96}" y="480" fill="${MUTED}" font-size="36" font-weight="600" font-family="Inter, sans-serif">/100</text>`
  }
  ${verdictLines
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${546 + index * 52}" fill="${TEXT}" font-size="44" font-weight="700" font-family="Inter, sans-serif">${escapeXml(line)}</text>`,
    )
    .join('')}
  <text x="${MARGIN}" y="${546 + verdictLines.length * 52 + 8}" fill="${MUTED}" font-size="24" font-family="Inter, sans-serif">0-100 percentile of cheapness vs the tracked universe</text>

  ${
    score === null
      ? ''
      : `<rect x="${MARGIN}" y="676" width="${CONTENT}" height="16" rx="8" fill="${PANEL}" stroke="${HAIRLINE}" stroke-width="1"/>
  <rect x="${MARGIN}" y="676" width="${rulerWidth.toFixed(1)}" height="16" rx="8" fill="${ACCENT}"/>
  <text x="${MARGIN}" y="720" fill="${MUTED}" font-size="24" font-family="Inter, sans-serif">expensive</text>
  <text x="${WIDTH - MARGIN}" y="720" fill="${MUTED}" font-size="24" text-anchor="end" font-family="Inter, sans-serif">cheapest</text>`
  }

  ${evidencePanel(options.dipHistory ?? [])}

  ${statColumn(MARGIN, 'FROM ITS DIP', pct(coin.distance_pct_event, 1), options.referenceLabel ?? 'vs the 2021 low', (coin.distance_pct_event ?? 0) <= 15 ? GREEN : TEXT)}
  ${statColumn(MARGIN + 318, 'DIP RESPECT', coin.dip_bounces ? `${coin.dip_bounces}×` : '0×', coin.dip_bounce_avg ? `avg bounce ${pct(coin.dip_bounce_avg, 0)}` : 'no proven bounce yet')}
  ${statColumn(MARGIN + 636, '3Y VALUATION', coin.valuation_pct_3y !== null && coin.valuation_pct_3y !== undefined ? `P${Math.round(coin.valuation_pct_3y)}` : '—', coin.valuation_pct_3y !== null && coin.valuation_pct_3y !== undefined ? 'share of its own days below today' : 'not enough history yet')}

  ${footer(options.dateLabel)}
</svg>`;
}

export interface DigestCardOptions {
  dateLabel: string;
  subtitle?: string;
}

export function buildDigestCardSvg(coins: Coin[], options: DigestCardOptions): string {
  const ranked = coins.slice(0, 5);
  const hero = ranked[0];
  const rest = ranked.slice(1);

  const heroBlock = hero
    ? (() => {
        const symbol = hero.base_asset ?? hero.symbol.replace(/(USDT|BTC)$/, '');
        const score = hero.value_score !== null && hero.value_score !== undefined ? Math.round(hero.value_score) : null;
        const detail = [
          score !== null ? scoreVerdict(score).toLowerCase() : 'not enough history for a score',
          hero.dip_bounces ? `${hero.dip_bounces}× dip respect` : null,
          `${pct(hero.distance_pct_event, 1)} from dip`,
        ]
          .filter(Boolean)
          .join(' · ');
        return `
        <text x="${MARGIN}" y="300" fill="${MUTED}" font-size="30" font-weight="700" letter-spacing="2" font-family="Inter, sans-serif">#1</text>
        <text x="${MARGIN}" y="392" fill="${TEXT}" font-size="84" font-weight="800" font-family="Inter, sans-serif">$${escapeXml(symbol)}</text>
        <text x="${WIDTH - MARGIN}" y="392" fill="${ACCENT}" font-size="150" font-weight="800" text-anchor="end" font-family="Inter, sans-serif">${score ?? '—'}</text>
        <text x="${MARGIN}" y="452" fill="${MUTED}" font-size="30" font-family="Inter, sans-serif">${escapeXml(detail)}</text>
        <line x1="${MARGIN}" y1="500" x2="${WIDTH - MARGIN}" y2="500" stroke="${HAIRLINE}" stroke-width="1" opacity="0.4"/>`;
      })()
    : '';

  const rows = rest
    .map((coin, index) => {
      const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
      const score = coin.value_score !== null && coin.value_score !== undefined ? Math.round(coin.value_score) : '—';
      const name = symbol.length > 9 ? `${symbol.slice(0, 8)}…` : symbol;
      const y = 570 + index * 148;
      return `
      <g transform="translate(${MARGIN}, ${y})">
        <text x="0" y="42" fill="${MUTED}" font-size="34" font-family="Inter, sans-serif">${index + 2}</text>
        <text x="64" y="42" fill="${TEXT}" font-size="48" font-weight="700" font-family="Inter, sans-serif">$${escapeXml(name)}</text>
        <text x="64" y="80" fill="${MUTED}" font-size="26" font-family="Inter, sans-serif">${coin.dip_bounces ? `${coin.dip_bounces}× proven dip bounces` : 'no proven dip bounce yet'}</text>
        <text x="620" y="44" fill="${ACCENT}" font-size="56" font-weight="700" text-anchor="end" font-family="Inter, sans-serif">${score}</text>
        <text x="${CONTENT}" y="42" fill="${TEXT}" font-size="36" text-anchor="end" font-family="Inter, sans-serif">${pct(coin.distance_pct_event, 1)} from dip</text>
        <line x1="0" y1="102" x2="${CONTENT}" y2="102" stroke="${HAIRLINE}" stroke-width="1" opacity="0.3"/>
      </g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  ${header(options.dateLabel)}
  <text x="${MARGIN}" y="188" fill="${TEXT}" font-size="44" font-weight="700" font-family="Inter, sans-serif">${escapeXml(options.subtitle ?? 'Daily board · cheapest tracked alts')}</text>
  <text x="${MARGIN}" y="230" fill="${MUTED}" font-size="26" font-family="Inter, sans-serif">Ranked by Value Score (ties broken by proven dip bounces)</text>
  ${heroBlock}
  ${rows}
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
    score !== null ? `🎯 $${symbol} · Value Score ${score}/100 — ${scoreVerdict(score).toLowerCase()}` : `🎯 $${symbol} · not enough history for a score yet`,
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
  return [
    `🎯 Dip Radar daily board · ${dateLabel}`,
    'Cheapest tracked altcoins vs their own history (BTC parity):',
    ...lines,
    '',
    'Ranked by Value Score, ties broken by proven dip bounces.',
    '#crypto #altcoins #BTC',
  ].join('\n');
}
