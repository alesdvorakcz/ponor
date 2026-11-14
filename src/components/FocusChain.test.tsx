import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FocusChainProvider, nextInOrder, useFocusChainStep, type FocusChainStep } from './FocusChain';

// The order is the form's own declared field order, which names every field — pickers and chip
// rows included. Only the text fields that are on screen register, so the walk is over what a
// keyboard can actually land in.
const ORDER = ['date', 'siteName', 'centerName', 'maxDepthM', 'timeIn', 'buddy', 'notes'];

it('steps to the next text field on screen, past fields no keyboard can land in', () => {
  const mounted = new Set(['siteName', 'centerName', 'maxDepthM', 'buddy']);
  expect(nextInOrder(ORDER, mounted, 'siteName')).toBe('centerName');
  // `timeIn` is a picker and never registers, so it is stepped over.
  expect(nextInOrder(ORDER, mounted, 'maxDepthM')).toBe('buddy');
});

// A collapsed group's fields are not mounted, so the step goes to the next field the diver can
// see rather than into a field hidden behind a chevron.
it('steps over a field that is not on screen', () => {
  expect(nextInOrder(ORDER, new Set(['siteName', 'notes']), 'siteName')).toBe('notes');
});

it('has nowhere to go from the last field, or from a field it does not know', () => {
  const mounted = new Set(['siteName', 'notes']);
  expect(nextInOrder(ORDER, mounted, 'notes')).toBeNull();
  expect(nextInOrder(ORDER, mounted, 'somethingElse')).toBeNull();
});

/** One field's half of the chain, exposed so the test can press its return key. */
function Field({ name, steps, stepsOn = true }: { name: string; steps: Map<string, FocusChainStep | undefined>; stepsOn?: boolean }) {
  steps.set(name, useFocusChainStep(name, stepsOn));
  return <Text>{name}</Text>;
}

it('moves focus to the next field on screen when a field’s return key is pressed', async () => {
  const focus = jest.fn();
  const end = jest.fn();
  const steps = new Map<string, FocusChainStep | undefined>();
  await render(
    <FocusChainProvider order={ORDER} focus={focus} onEnd={end}>
      <Field name="siteName" steps={steps} />
      <Field name="maxDepthM" steps={steps} />
    </FocusChainProvider>,
  );
  const site = steps.get('siteName');
  expect(site?.returnKeyType).toBe('next');
  await act(() => site?.onSubmitEditing());
  expect(focus).toHaveBeenLastCalledWith('maxDepthM');

  // From the last field on screen there is nothing to step to, so the keyboard goes away.
  await act(() => steps.get('maxDepthM')?.onSubmitEditing());
  expect(end).toHaveBeenCalledTimes(1);
});

// Notes is a paragraph: its return key writes a new line, so it takes no step of its own —
// but it is still a field the step from the row above can land in.
it('lands on a field that takes no step of its own, without giving it a return key', async () => {
  const focus = jest.fn();
  const steps = new Map<string, FocusChainStep | undefined>();
  await render(
    <FocusChainProvider order={ORDER} focus={focus} onEnd={() => {}}>
      <Field name="buddy" steps={steps} />
      <Field name="notes" steps={steps} stepsOn={false} />
    </FocusChainProvider>,
  );
  expect(steps.get('notes')).toBeUndefined();
  await act(() => steps.get('buddy')?.onSubmitEditing());
  expect(focus).toHaveBeenLastCalledWith('notes');
});

it('forgets a field once it leaves the screen', async () => {
  const focus = jest.fn();
  const end = jest.fn();
  const steps = new Map<string, FocusChainStep | undefined>();
  const tree = (withDepth: boolean) => (
    <FocusChainProvider order={ORDER} focus={focus} onEnd={end}>
      <Field name="siteName" steps={steps} />
      {withDepth && <Field name="maxDepthM" steps={steps} />}
    </FocusChainProvider>
  );
  const t = await render(tree(true));
  await t.rerender(tree(false));
  await act(() => steps.get('siteName')?.onSubmitEditing());
  expect(focus).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledTimes(1);
});

// Outside a chain a field is exactly what it was: no return key of its own, no step.
it('offers no step outside a chain', async () => {
  const steps = new Map<string, FocusChainStep | undefined>();
  await render(<Field name="siteName" steps={steps} />);
  expect(steps.get('siteName')).toBeUndefined();
});
