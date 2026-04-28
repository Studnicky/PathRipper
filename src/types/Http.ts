/** Discriminated union of HTTP/network error categories used by ErrorClassifier. */
export type ErrorCategoryType =
  | 'network'
  | 'permanent'
  | 'resource'
  | 'throttled'
  | 'timeout'
  | 'transient'
  | 'unknown'
  | 'validation';
