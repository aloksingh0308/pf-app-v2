export function getUserFriendlyErrorMessage(error: unknown, fallbackMessage = 'Something went wrong. Please try again.'): string {
  const code = String((error as any)?.code || '').toLowerCase();
  const message = String((error as any)?.message || '').toLowerCase();

  // Auth-specific errors — check before generic network test so they are not swallowed
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('invalid-login-credentials')) {
    return 'The email or password you entered is incorrect.';
  }

  if (code.includes('user-not-found')) {
    return 'No account found with this email. Please sign up first.';
  }

  if (code.includes('too-many-requests')) {
    return 'Too many attempts. Please wait and try again.';
  }

  if (code.includes('email-already-in-use')) {
    return 'This email is already registered. Please log in instead.';
  }

  if (code.includes('user-disabled')) {
    return 'This account has been disabled.';
  }

  if (code.includes('network-request-failed')) {
    return fallbackMessage !== 'Something went wrong. Please try again.'
      ? fallbackMessage
      : 'Network error. Please check your internet connection and try again.';
  }

  if (message.includes('network') && !code.startsWith('auth/')) {
    return 'Network issue detected. Please check your internet connection and try again.';
  }

  if (code.includes('timeout') || message.includes('timeout')) {
    return 'The request took too long. Please try again.';
  }

  if (code.includes('permission-denied') || code.includes('unauthorized') || message.includes('permission')) {
    return 'You do not have permission to perform this action.';
  }

  if (code.includes('not-found') || message.includes('not found')) {
    return 'Requested data was not found.';
  }

  if (code.includes('unavailable') || message.includes('service unavailable')) {
    return 'Service is temporarily unavailable. Please try again shortly.';
  }

  return fallbackMessage;
}
