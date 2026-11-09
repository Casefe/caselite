import { useMemo, useState } from 'react';
import type { TextPage } from '../../preload/caselite-api';
export default function PhotoReader({
  bytes,
  name,
  textPages = [],
  onClose,
}: {
  bytes: Uint8Array;
  name: string;
  textPages?: TextPage[];
  onClose(): void;
}) {
  const [zoom, setZoom] = useState(1);
  const image = useMemo(() => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return `data:image/${bytes[0] === 137 ? 'png' : 'jpeg'};base64,${btoa(binary)}`;
  }, [bytes]);
  return (
    <section className="pdf-reader" aria-label="照片原件">
      <header>
        <strong>{name}</strong>
        <button disabled={zoom <= 1} onClick={() => setZoom((value) => value - 0.5)}>
          缩小
        </button>
        <output aria-label="照片缩放比例">{zoom * 100}%</output>
        <button disabled={zoom >= 3} onClick={() => setZoom((value) => value + 0.5)}>
          放大
        </button>
        <button onClick={onClose}>关闭原件</button>
      </header>
      <div className="photo-original">
        <img src={image} alt={name} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />
      </div>
      {textPages.length > 0 && (
        <details>
          <summary>本机识别文字（待核对）</summary>
          {textPages.map((page) => (
            <pre key={page.page}>{page.text}</pre>
          ))}
        </details>
      )}
    </section>
  );
}
