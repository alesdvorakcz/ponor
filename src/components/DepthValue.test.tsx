import { render } from '@testing-library/react-native';

import { DepthValue } from './DepthValue';

// DESIGN.md §10: no CHECK constraint on any numeric dive field, so a negative
// max_depth_m is a runtime reality this component cannot rule out — a bad import or a
// future sync client can hand it one. depthBand/depthColor's throw-on-invalid contract
// is correct for a pure function (see theme/depth.test.ts), but a render path may not
// throw, so DepthValue must go through the null-safe depthColorOrNull instead and
// render nothing, the same way it already does for an unrecorded depth.
it('renders nothing for a negative depth, without a crash or a placeholder', async () => {
  const t = await render(<DepthValue metres={-5} scheme="dark" />);
  expect(t.toJSON()).toBeNull();
});
