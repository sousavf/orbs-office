import { Vector3 } from 'three';

/**
 * Linear colour multiplied onto every character sprite: the scene's light level as the billboards see it.
 * Shared by reference with the character shader's uniform, so writing `.value` relights all characters.
 */
export const characterLight: { value: Vector3 } = { value: new Vector3(1, 0.97, 0.92) };
