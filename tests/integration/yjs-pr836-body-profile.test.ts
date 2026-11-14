// @vitest-environment jsdom
import { it } from 'vitest';
import { probeSplitUndo } from './yjs-pr836-profile-fixture';
it('restores the original text with the BodyEditor saved-state and true,true extensions', () => {
  probeSplitUndo('body');
});
