import { LegacyTokenRedirect } from '@/components/LegacyTokenRedirect';

// Old /reset-password/<token> links (emails sent before the token moved behind the `#`).
export default function LegacyResetPasswordLink() {
  return <LegacyTokenRedirect page="reset-password" />;
}
