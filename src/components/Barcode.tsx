const CODE39_MAP: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

interface BarcodeProps {
  value: string;
}

export function Barcode({ value }: BarcodeProps) {
  const safe = value
    .toUpperCase()
    .split('')
    .map((ch) => (CODE39_MAP[ch] ? ch : '-'))
    .join('');
  const encoded = `*${safe}*`;

  const bars: { x: number; width: number }[] = [];
  let cursor = 6; // quiet zone

  for (let c = 0; c < encoded.length; c += 1) {
    const pattern = CODE39_MAP[encoded[c]] ?? CODE39_MAP['-'];
    for (let i = 0; i < pattern.length; i += 1) {
      const unitWidth = pattern[i] === 'w' ? 3 : 1;
      if (i % 2 === 0) {
        bars.push({ x: cursor, width: unitWidth });
      }
      cursor += unitWidth;
    }
    if (c < encoded.length - 1) {
      cursor += 1; // inter-character narrow gap
    }
  }

  const totalWidth = cursor + 6;

  return (
    <div className="ticket-barcode-wrap">
      <svg
        className="ticket-barcode-svg"
        viewBox={`0 0 ${totalWidth} 32`}
        role="img"
        aria-label={`Código de barras ${safe}`}
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width={totalWidth} height="32" fill="#ffffff" />
        {bars.map((bar, index) => (
          <rect
            key={`${bar.x}-${index}`}
            x={bar.x}
            y="2"
            width={bar.width}
            height="28"
            fill="#111827"
          />
        ))}
      </svg>
      <div className="ticket-center" style={{ fontSize: '0.8em' }}>
        *{safe}*
      </div>
    </div>
  );
}
