/**
 * @file address.schema.validator.ts
 * @description Zod schema definitions for API response contract validation.
 *
 * Validates the SHAPE of address objects returned by the API (field presence
 * and types), NOT business rules. Business-rule validation lives in
 * {@link BusinessRuleValidator}.
 *
 * The schema uses `.passthrough()` to tolerate unknown fields, and
 * {@link checkContractDrift} logs warnings when new fields appear
 * (indicating API evolution that may need test updates).
 *
 * @module address.schema.validator
 */
import { z } from 'zod';

/**
 * Zod schema for a single address object.
 * Describes the ACTUAL API response shape — intentionally does not enforce
 * BR-002 (50 char max) here since that is a business rule, not a contract shape.
 * Uses `.passthrough()` so unknown fields don't fail validation.
 */
export const AddressSchema = z.object({
  id: z.number().positive(),
  address: z.string(), // No max(50) — schema validation, not BR validation
  street: z.string().optional().nullable(),
  name: z.string(),
  building: z.string().optional().nullable(),
  floor: z.union([z.string(), z.number()]).optional().nullable(),
  apartment: z.union([z.string(), z.number()]).optional().nullable(),
  lat: z.union([z.number(), z.string()]).optional().nullable(),
  long: z.union([z.number(), z.string()]).optional().nullable(),
  is_default: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
  deleted_at: z.string().nullable().optional(),
  // Allow extra fields from API without breaking validation
  client_id: z.number().optional().nullable(),
  province: z.any().optional(),
  province_zone: z.any().optional(),
}).passthrough(); // Allow unknown keys without failing

export type Address = z.infer<typeof AddressSchema>;

/**
 * Detects new fields in API responses that aren't in the Zod schema.
 * Logs warnings for contract drift monitoring (fields added by backend
 * without corresponding schema updates).
 *
 * @param data - Raw API response object
 * @param schema - Zod schema to compare against
 */
export const checkContractDrift = (data: any, schema: z.ZodObject<any>) => {
  if (!data || typeof data !== 'object') return;
  const knownKeys = Object.keys(schema.shape);
  const dataKeys = Object.keys(data);
  const unknownKeys = dataKeys.filter(k => !knownKeys.includes(k));

  if (unknownKeys.length > 0) {
    console.warn(`[Contract Drift] New fields: ${unknownKeys.join(', ')}`);
  }
};

/** Validates a single address and checks for contract drift. */
export const validateAddressSchema = (data: any) => {
  checkContractDrift(data, AddressSchema);
  return AddressSchema.safeParse(data);
};

/** Validates an array of addresses and checks each for contract drift. */
export const validateAddressArray = (data: any[]) => {
  if (Array.isArray(data)) {
    data.forEach(item => checkContractDrift(item, AddressSchema));
  }
  return z.array(AddressSchema).safeParse(data);
};
