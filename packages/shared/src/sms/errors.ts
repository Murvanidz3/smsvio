/** Stable SMS error codes and the explanation shown next to a message. */
export const SMS_ERRORS = {
  invalid_number: 'That phone number is not a valid number.',
  invalid_sender: 'That sender id is not allowed for this destination.',
  sender_not_approved: 'That sender id is not approved for this destination.',
  country_not_enabled: 'Sending to that country is not turned on for this organization.',
  country_not_supported: 'SMSVIO cannot send to that country.',
  registration_required: 'That destination needs a completed registration before you can send.',
  recipient_opted_out: 'That number has opted out.',
  message_too_long: 'That message is longer than the segment limit.',
  missing_variable: 'A template variable has no value.',
  template_not_approved: 'Only an approved template can be sent.',
  insufficient_balance: 'The balance is too low to send this message.',
  spend_cap_reached: 'This send would pass the daily spend cap.',
  rate_limited: 'Too many requests. Try again later.',
  organization_not_verified: 'Verify the organization before sending to other numbers.',
  organization_suspended: 'This organization is suspended.',
  no_route: 'No route is available for that destination.',
  carrier_rejected: 'The carrier rejected the message.',
  absent_subscriber: 'The handset could not be reached.',
  blocked_by_carrier: 'The carrier blocked the message.',
  unknown_subscriber: 'The carrier does not recognise that number.',
  expired: 'The message expired before it was delivered.',
  internal_error: 'Something went wrong while sending. Try again.',
} as const;

export type SmsErrorCode = keyof typeof SMS_ERRORS;

export function smsErrorMessage(code: SmsErrorCode): string {
  return SMS_ERRORS[code];
}
