import React from 'react';
import useReveal from '../hooks/useReveal';

/**
 * Fades and lifts its children in the first time they scroll into view.
 *
 * Used everywhere a block renders a heading or a grid of cards — wrapping
 * each card individually (rather than the grid as one block) means cards
 * further down the page naturally trigger a beat later than the ones above
 * them, without any manual per-row choreography. `delay` adds a small,
 * capped stagger for cards that enter the viewport in the same scroll frame
 * (e.g. a row of three), so they do not all pop in at once.
 */
const Reveal = ({ children, as: Tag = 'div', delay = 0, className = '', style, ...rest }) => {
  const { ref, visible } = useReveal();

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? 'reveal-visible' : ''} ${className}`}
      style={{ ...style, transitionDelay: visible && delay ? `${delay}ms` : undefined }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default Reveal;
