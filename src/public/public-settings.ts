import { DEFAULT_WORKING_HOURS, emptySettings } from '../../shared/office-settings';
import type { OfficeSettings } from '../../shared/office-settings';
import type { SettingsSource } from '../office-contracts';

/**
 * Fixed office settings for every viewer: default working hours (Mon-Fri 07:00-19:00, lunch
 * 12:30-14:00, read in the office's own time zone) and default island names. Nothing is loaded or saved.
 */
export function createPublicSettings(): SettingsSource {
  const settings: OfficeSettings = { ...emptySettings(), workingHours: { ...DEFAULT_WORKING_HOURS } };
  return {
    get: () => settings,
    subscribe: () => () => {},
  };
}
