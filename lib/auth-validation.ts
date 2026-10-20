const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const MAX_SIGNUP_PASSWORD = 128;
const MAX_LOGIN_PASSWORD = 1024;
const MAX_PROFILE_FIELD = 120;

export type SignupCredentials = {
  fullName: string;
  restaurantName: string;
  email: string;
  phone: string;
  password: string;
  agreed: boolean;
};

export function getSignupValidationError(input: SignupCredentials): string | null {
  const { fullName, restaurantName, email, phone, password, agreed } = input;

  if (!fullName || !restaurantName) return 'Please enter your name and your restaurant name.';
  if (fullName.length > MAX_PROFILE_FIELD || restaurantName.length > MAX_PROFILE_FIELD) {
    return 'Name fields must be 120 characters or fewer.';
  }
  if (!EMAIL.test(email) || email.length > 254) return 'Please enter a valid email address.';
  if (phone.length > 30) return 'Please enter a mobile number of 30 characters or fewer.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_SIGNUP_PASSWORD) return 'Password must be 128 characters or fewer.';
  if (!agreed) return 'Please confirm that you understand how this preview uses your account details.';
  return null;
}

export function isValidSignInInput(email: string, password: string): boolean {
  return EMAIL.test(email) && email.length <= 254 && password.length > 0 && password.length <= MAX_LOGIN_PASSWORD;
}

export function getPasswordResetValidationError(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_SIGNUP_PASSWORD) return 'Password must be 128 characters or fewer.';
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}
