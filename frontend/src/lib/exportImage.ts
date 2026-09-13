const INLINE_STYLES = `
  .scatter-axis text { fill: #b3a68c; font-size: 10px; font-family: ui-monospace, monospace; }
  .scatter-axis .domain { stroke: #4d4533; }
  .scatter-axis .tick line { stroke: #4d4533; opacity: 0.35; }
  .scatter-axis-label { fill: #b3a68c; font-size: 11px; }
  .scatter-label { fill: #f1e8d7; font-size: 10px; font-family: ui-monospace, monospace; }
  .treemap-label { fill: #f1e8d7; font-size: 11px; font-weight: 600; font-family: ui-monospace, monospace; }
  .treemap-sub { fill: rgba(241,232,215,0.8); font-size: 10px; font-family: ui-monospace, monospace; }
`;

/**
 * Serialize an SVG chart to a PNG download. CSS classes are inlined and a
 * dark background is added so the exported image matches the dashboard.
 */
export async function exportSvgToPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(rect.width, 320);
  const height = Math.max(rect.height, 240);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = INLINE_STYLES;

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#12100b');

  clone.insertBefore(background, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas is not supported'));
        return;
      }
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
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
