// @vitest-environment jsdom
import { it } from 'vitest';
import { probeSplitUndo } from './yjs-pr836-profile-fixture';
it('restores the original text with the TaskContentEditor saved-state and default extensions', () => {
  probeSplitUndo('task');
});
