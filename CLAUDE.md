## API Contract Assumptions
Never assume API response structures, field names, or required payload fields. Always read existing API client code, swagger/OpenAPI specs, or run a sample request first before writing tests or integrations. Common pitfalls: `access_token` vs `token`, `status:'success'` vs `success:true`, field type mismatches (string vs integer).

## Testing

### Test Framework Conventions (TypeScript)
- When generating test data, ensure field types strictly match the API schema (e.g., floor must be integer, not string)
- Always validate expected HTTP status codes against the actual API behavior before writing assertions (e.g., check if endpoint returns 401 vs 405 for unauthorized access)
- When building reporters/dashboards, ensure the output schema of the reporter matches the input schema expected by the HTML consumer
- Minimum test count requirements must be verified with a final count assertion

## Workflow

### Iteration Discipline
When making large-scale changes (200+ tests, multi-file refactors, pipeline implementations), break work into phases and validate each phase before proceeding. After each phase: 1) Run type checks (`tsc --noEmit`), 2) Run a subset of tests, 3) Confirm output format compatibility with downstream consumers.
