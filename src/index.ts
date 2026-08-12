// Convex/server entry point. Must never import from react or next.

export {
  createAmadeniAuthOptions,
  MAGIC_LINK_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  type AmadeniAuthOptionsConfig,
  type SendMagicLink,
} from './authOptions.js';
export { canonicalizeAuthEmail } from './canonicalizeEmail.js';
export {
  createEligibilityHandler,
  createEligibilityHook,
  evaluateLoginEligibility,
  resolveEligibilityEmail,
  resolveVerifyEmailFromHashedToken,
  type EligibilityHookConfig,
  type EligibilityHookContext,
  type LoginEligibility,
  type ResolveEmailForVerify,
} from './eligibility.js';
export {
  DEFAULT_BRAND_COLOR,
  renderMagicLinkEmail,
  type MagicLinkBrand,
} from './emailTemplate.js';
export {
  AUTH_ERROR_CODES,
  type AuthErrorCode,
  type AuthErrorCodeValue,
} from './errorCodes.js';
export { hashVerificationToken } from './hashToken.js';
export {
  createLazyLinkTrigger,
  type LazyLinkReason,
  type LazyLinkTriggerConfig,
} from './lazyLink.js';
export {
  createResendMagicLinkSender,
  resolveResendApiKey,
  type ResendMagicLinkSenderConfig,
} from './resend.js';
export { buildInterstitialLoginUrl, buildMagicLinkVerifyUrl } from './urls.js';
