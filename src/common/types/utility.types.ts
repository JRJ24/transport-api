export type Nullable<T> = T | null;

export type Maybe<T> = T | undefined;

/** Makes the listed keys required while keeping the rest unchanged. */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
