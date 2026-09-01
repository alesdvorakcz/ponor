import { render, type RenderResult } from '@testing-library/react-native';
import { View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { FieldNote } from './FieldNote';

/**
 * Rendered inside a host `View`, deliberately. `t.root`'s `queryAll` walks DESCENDANTS and
 * never returns the instance it is called on (`unexpectedGraphics`'s own docblock records
 * finding that the hard way), so a bare `<FieldNote>` would put the one view this component
 * draws exactly where no query can see it — and "draws nothing at all" would then be a test
 * that passes whatever this component does.
 */
const renderNote = (message: string | undefined) =>
  render(
    <View>
      <FieldNote message={message} scheme="light" />
    </View>,
  );

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function viewsIn(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'View') : [];
}

it('says what it was given', async () => {
  const t = await renderNote('Enter a real date (YYYY-MM-DD).');
  expect(textIn(t)).toEqual(['Enter a real date (YYYY-MM-DD).']);
});

// A field with nothing to say draws NOTHING — not an empty container holding a blank line,
// which would put a gap of the note's own height under every field on a form that is working
// perfectly. Asserted on the views as well as the text, since an empty `<View>` renders no
// text either way.
it('draws nothing at all when there is nothing to say', async () => {
  const t = await renderNote(undefined);
  expect(textIn(t)).toEqual([]);
  expect(viewsIn(t)).toEqual([]);
});

/**
 * §0.6: "**A field error is text, not a field.** Muted, trailing, under the row it belongs
 * to." That rule has a shipped defect behind it — the message was once "a white rounded box
 * the same height as an input, which read as a second empty field rather than as a message"
 * — which is why this is asserted here rather than left to the screens: the two of them
 * share this component precisely so the box cannot come back in one of them.
 *
 * Read off `makeStyles` rather than retyped, so it cannot be satisfied by a literal that
 * merely looks right.
 */
it('wears the form’s note treatment, which is deliberately not a box', async () => {
  const t = await renderNote('anything');
  const styles = makeStyles('light');
  const [wrapper] = viewsIn(t);
  expect([wrapper?.props?.style].flat(5)).toContain(styles.formFieldError);
  // The two properties that make it a message rather than a field, named individually so a
  // fill or a border added to that style fails here.
  expect((styles.formFieldError as Record<string, unknown>).backgroundColor).toBeUndefined();
  expect((styles.formFieldError as Record<string, unknown>).borderWidth).toBeUndefined();
});
