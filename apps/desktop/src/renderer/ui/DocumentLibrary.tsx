import type { ComponentProps } from 'react';
import { FavoriteButton } from '../features/favorites/Favorites';
import DocumentWorkspace from '../features/documents/DocumentWorkspace';

export default function DocumentLibrary(
  props: Omit<ComponentProps<typeof DocumentWorkspace>, 'FavoriteButton'>,
) {
  return <DocumentWorkspace {...props} FavoriteButton={FavoriteButton} />;
}
