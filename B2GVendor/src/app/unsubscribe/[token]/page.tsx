import { LegacyTokenRedirect } from '@/components/LegacyTokenRedirect';

// Old /unsubscribe/<token> links (emails sent before the token moved behind the `#`).
export default function LegacyUnsubscribeLink() {
  return <LegacyTokenRedirect page="unsubscribe" />;
}
