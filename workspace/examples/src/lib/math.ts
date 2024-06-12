export const createMapToDomain =
    (from: {min: number; max: number}, to: {min: number; max: number}) =>
    (a: number): number =>
        to.min + ((a - from.min) * (to.max - to.min)) / (from.max - from.min);
