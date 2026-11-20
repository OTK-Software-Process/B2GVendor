import { LegacyTokenRedirect } from '@/components/LegacyTokenRedirect';

// Old /verify-email/<token> links (emails sent before the token moved behind the `#`).
export default function LegacyVerifyEmailLink() {
  return <LegacyTokenRedirect page="verify-email" />;
}
