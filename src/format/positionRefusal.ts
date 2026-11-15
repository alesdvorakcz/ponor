import { t } from '../i18n';
import { COARSEST_USABLE_FIX_M, type PositionRefusal } from '../platform/location';

/*
 * A module of its own rather than a function in `display.ts`, because of the import above:
 * `imprecise` needs `COARSEST_USABLE_FIX_M`, whose owner is `platform/location.ts`, and that module
 * loads `expo-location` the moment it is imported. `display.ts` is imported by nearly every file in
 * the app and imports nothing from `platform/`; this keeps it that way, and only the two screens
 * that ask the device for a pin — both of which already import `platform/location` — import this.
 */

/**
 * **What each way of failing to get a pin says to the diver** — one sentence per refusal, and a
 * `Record` over `POSITION_REFUSALS` so a refusal added to `platform/location.ts` cannot arrive without
 * one (§4.1's "derive, or tie at compile time"). A missing key is a build error; a missing sentence
 * would be a control that did nothing.
 *
 * **Two screens ask the same question for the same purpose**, which is why this is their one owner:
 * the dive form's GPS row (M2l) and the *New dive site / New dive centre* page's *Use current
 * position* (issue #19). Both call `currentPosition`, the request for a pin that will be stored, so
 * *"too rough to pin a dive site"* is the true reason on both. (The picker's *Near me* asks a
 * different question — `roughPosition`, for a list — and words its refusals for a list.)
 *
 * **That a denial says something at all is the load-bearing part** (§10's "a local save failure is
 * shown to the diver", applied to the one other thing on these screens that can fail without the
 * diver having done anything wrong). iOS raises its permission sheet **once ever**: a diver who
 * declines it and later wants a pin gets no sheet on the second tap, so without a sentence the
 * control would simply stop working, silently and permanently. That is the dead-control shape §0.6
 * has already recorded three times — the hidden pull-down search, the invisible clear target over
 * the word "carried", the form with no visible way out — and each was found by using the app rather
 * than by a test.
 *
 * So `denied` names the place the switch is and invites the next tap, which is the half a sentence
 * alone would not have: the control goes on asking every time it is pressed
 * (`platform/locationPermission.ts` caches nothing), so a diver who goes to Settings and comes back
 * gets a pin without reopening the screen. **§3's Settings screen is where this stops being a
 * sentence and becomes a control** (the owner's call, M2l): a location row there shows the standing
 * permission and offers the way into the device's own Settings app. It is a separate task, and
 * `locationPermission()` — which reads the state without ever raising a prompt — is the surface it
 * will read.
 *
 * `imprecise` names the threshold rather than what the fix actually reported, because the figure
 * comes from the one place that owns it (`COARSEST_USABLE_FIX_M`) rather than being retyped here,
 * and because what the diver can act on is the standard, not the miss.
 *
 * §1 binds every one of these: they are text under a control, never a blocked save. A diver who
 * cannot get a pin logs the dive — or makes the site — without one.
 */
const POSITION_REFUSAL_SENTENCES: Record<PositionRefusal, () => string> = {
  servicesOff: () => t('form.positionServicesOff'),
  denied: () => t('form.positionDenied'),
  timedOut: () => t('form.positionTimedOut'),
  // The threshold reaches the sentence as a value rather than as a template literal, so
  // `COARSEST_USABLE_FIX_M` is still the one place that owns the figure and the comma a Czech
  // reader expects still comes from `figure` (src/i18n).
  imprecise: () => t('form.positionImprecise', { metres: COARSEST_USABLE_FIX_M }),
  failed: () => t('form.positionFailed'),
};

/** The sentence for one refusal, in the language the app is in now. */
export function positionRefusalSentence(reason: PositionRefusal): string {
  return POSITION_REFUSAL_SENTENCES[reason]();
}
