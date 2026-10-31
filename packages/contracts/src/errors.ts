import { z } from 'zod';

export const applicationErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'PROTOCOL_UNSUPPORTED',
  'FORBIDDEN',
  'CONFLICT',
  'IPC_TIMEOUT',
  'INTERNAL',
]);

export const applicationErrorSchema = z.object({
  code: applicationErrorCodeSchema,
  message: z.string().min(1).max(240),
  field_errors: z
    .array(
      z.object({
        path: z.string().min(1).max(160),
        message: z.string().min(1).max(240),
      }),
    )
    .optional(),
  retryable: z.boolean(),
  recovery_action: z.enum([
    'correct_input',
    'upgrade_client',
    'refresh_and_retry',
    'request_access',
    'check_status',
    'contact_support',
  ]),
  correlation_id: z.string().uuid(),
});

export type ApplicationError = z.infer<typeof applicationErrorSchema>;
