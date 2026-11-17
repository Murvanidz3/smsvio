export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly instance: string;
  readonly errors?: Readonly<Record<string, string>>;
}

const TITLES: Readonly<Record<string, string>> = {
  unauthenticated: 'Authentication required',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  validation_error: 'Validation failed',
  duplicate_contact: 'Duplicate contact',
  conflict: 'Conflict',
  rate_limited: 'Rate limited',
};

export function problemDetails(input: {
  status: number;
  code: string;
  detail: string;
  instance: string;
  errors?: Readonly<Record<string, string>>;
}): ProblemBody {
  return {
    type: `https://smsvio.com/docs/errors/${input.code}`,
    title: TITLES[input.code] ?? 'Request failed',
    status: input.status,
    detail: input.detail,
    code: input.code,
    instance: input.instance,
    ...(input.errors === undefined || Object.keys(input.errors).length === 0
      ? {}
      : { errors: input.errors }),
  };
}
