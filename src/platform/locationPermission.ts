import * as Location from 'expo-location';

/**
 * **Whether this app can locate the diver right now, and if not, whose switch says so.**
 *
 * A closed vocabulary, with the type derived from the list rather than written twice (§4.1's
 * "derive, or tie at compile time", the same shape `domain/types.ts` uses for every list a
 * form offers). Five states rather than a boolean, because each one sends the diver somewhere
 * different — and the whole reason this module exists is that two screens are about to ask
 * this question: the dive form's *use my location* row, and §3's Settings screen, which shows
 * the standing answer and offers a way into the device's own Settings app to change it.
 *
 * - `granted` — the app may ask for a fix.
 * - `denied` — the diver said no, or said no once before. **On iOS the sheet appears once
 *   ever**, so this is where a second tap would silently do nothing if nobody said anything;
 *   the answer is the device's Settings app, which is what the Settings row is for.
 * - `undetermined` — nobody has been asked yet. Distinct from `denied` because the honest
 *   thing to tell a diver here is *"Ponor will ask the first time you use it"*, not *"go and
 *   change a setting"*.
 * - `servicesOff` — Location Services are off for the whole device, so no grant can help.
 *   **It outranks the permission**, including a permission already granted, because it is the
 *   fact that decides whether a fix is possible at all and the switch that fixes it is a
 *   different switch. It is reported by both functions below, which is why this is a state of
 *   *"can this app locate you"* rather than of the permission strictly speaking.
 * - `unknown` — the query itself failed. Named rather than folded into `denied`, because a
 *   screen that cannot ask must say so rather than assert a refusal nobody made.
 */
export const LOCATION_PERMISSION_STATES = [
  'granted',
  'denied',
  'undetermined',
  'servicesOff',
  'unknown',
] as const;

export type LocationPermissionState = (typeof LOCATION_PERMISSION_STATES)[number];

/**
 * The standing answer, **without ever raising a prompt**.
 *
 * That is the whole point of the split, and it is the half a Settings row needs: a screen
 * showing what the permission currently is must not change it by being looked at. iOS spends
 * its one permission sheet the first time something asks, so a Settings screen that "checked"
 * by requesting would burn the diver's one prompt on a row they were merely reading — and
 * would raise a system sheet on a screen nobody tapped a location control on.
 *
 * `getForegroundPermissionsAsync` is the read; `requestForegroundPermissionsAsync` is the
 * ask, below. They are two operations on this platform and this module keeps them two.
 */
export async function locationPermission(): Promise<LocationPermissionState> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'servicesOff';
    return stateOf(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

/**
 * The answer, asking the diver for it when there is no standing one — so this **may** raise
 * the system sheet, and `locationPermission` above never does.
 *
 * **Services are checked first, and that ordering is a rule rather than an optimisation.** On
 * a device with Location Services switched off no grant can produce a fix, and iOS raises its
 * permission sheet once ever: asking there would spend the diver's one prompt on a question
 * whose answer changes nothing, and leave them with a permission they cannot use and no sheet
 * left to raise once they have turned the switch back on.
 *
 * **It asks every time it is called, and remembers nothing.** After a denial iOS resolves this
 * immediately with the standing answer instead of showing a sheet — a fact about the platform,
 * not a reason for this module to cache the refusal. On Android and on the web the next tap
 * really can be granted, and a diver who turned the permission back on in the device's
 * Settings and came back gets a fix on their next tap on every platform. A remembered `denied`
 * would make the control that calls this dead for the life of the screen, and its caller could
 * not tell.
 */
export async function requestLocationPermission(): Promise<LocationPermissionState> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'servicesOff';
    return stateOf(await Location.requestForegroundPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

/**
 * One reading of expo-location's answer, shared by both functions above so a grant cannot mean
 * one thing to the row that asks and another to the row that reports.
 *
 * `granted` is the library's own convenience boolean rather than a comparison against
 * `PermissionStatus.GRANTED` — one reading of the answer, and the one the library guarantees.
 * `canAskAgain` is deliberately not read: **it is not a state, it is a prediction about the
 * next call**, and both callers of this behave identically either way — the row asks again
 * regardless, and the Settings screen offers the same way into the device's Settings whether
 * or not another sheet is theoretically possible.
 */
function stateOf(response: Location.LocationPermissionResponse): LocationPermissionState {
  if (response.granted) return 'granted';
  return response.status === Location.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}
