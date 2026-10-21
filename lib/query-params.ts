export type SearchParamValue = string | string[] | undefined;

export type SingleSearchParam =
  | { valid: true; value: string | undefined }
  | { valid: false; value: undefined };

/** Repeated query keys are ambiguous; callers can reject them instead of silently selecting a value. */
export function getSingleSearchParam(value: SearchParamValue): SingleSearchParam {
  return Array.isArray(value)
    ? { valid: false, value: undefined }
    : { valid: true, value };
}
