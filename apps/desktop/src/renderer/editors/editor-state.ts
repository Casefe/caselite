import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

export type RichDraft = { text: string; state: number[] | null };
export const emptyDraft = (): RichDraft => ({ text: '', state: null });
export function draftDoc(value: RichDraft) {
  const doc = new Y.Doc();
  if (value.state) Y.applyUpdate(doc, Uint8Array.from(value.state));
  else {
    for (const line of value.text.split('\n')) {
      const paragraph = new Y.XmlElement('paragraph');
      if (line) {
        const text = new Y.XmlText();
        text.insert(0, line);
        paragraph.insert(0, [text]);
      }
      const root = doc.getXmlFragment('default');
      root.insert(root.length, [paragraph]);
    }
  }
  return doc;
}
export function useLocalDoc(value: RichDraft) {
  const [doc] = useState(() => draftDoc(value));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => {
        if (!alive.current) doc.destroy();
      });
    };
  }, [doc]);
  return doc;
}
