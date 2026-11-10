import type { ReactNode } from 'react';

export type InspectorCard = {
  id: string;
  position: 'top' | 'middle' | 'bottom';
  content: ReactNode;
};
const order = { top: 0, middle: 20, bottom: 40 };

export default function InspectorCards({
  properties,
  cards,
}: {
  properties: ReactNode;
  cards: readonly InspectorCard[];
}) {
  return (
    <div className="inspector-card-stack">
      <div className="inspector-card-properties" style={{ order: 10 }}>
        {properties}
      </div>
      <div className="inspector-card-space" style={{ order: 15 }} aria-hidden="true" />
      <div className="inspector-card-space" style={{ order: 30 }} aria-hidden="true" />
      {/* 同一父节点和稳定键保留卡片身份；移位只改顺序，不重挂载属性或会话。 */}
      {cards.map((card) => (
        <div
          key={card.id}
          data-inspector-card={card.id}
          data-card-position={card.position}
          className="inspector-card-slot"
          style={{ order: order[card.position] }}
        >
          {card.content}
        </div>
      ))}
    </div>
  );
}
