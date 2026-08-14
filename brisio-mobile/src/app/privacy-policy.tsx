import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const policyText = `Brisio Privacy Policy
Effective Date: August 11, 2026
Last Updated: August 11, 2026

Brisio ("Brisio," "we," "us," or "our") respects your privacy. This Privacy Policy explains what information we collect, how we use it, how we protect it, when we share it, and the choices you have regarding your information when you use the Brisio mobile application and related services (collectively, the "Service").

By using Brisio, you acknowledge the practices described in this Privacy Policy.

1. Information We Collect
We collect information that you provide directly to us when you create an account, complete your profile, create or interact with listings, communicate with other users, or otherwise use Brisio.

A. Account Information
When you create a Brisio account, we may collect:
- Name
- Email address
- Password or authentication credentials
- Phone number
- Organization or business name
Your password is used to authenticate your account. Brisio does not use your password for advertising or unrelated purposes.

B. Address and Location Information
Brisio allows users to enter location information manually. This may include:
- Street address
- City
- State
- ZIP code
Brisio does not require access to your device's GPS location for the functionality described by this Privacy Policy.

Location information may be used to help users discover, provide, request, or coordinate resources in relevant geographic areas.

C. Listings and User-Generated Content
Brisio allows users and organizations to create listings involving available or requested resources.

Information included in listings may include descriptions, availability information, location information, organization information, and other content voluntarily submitted by the user.

You should avoid including unnecessary sensitive personal information in public listings.

D. Messages and Communications
Brisio may collect and store messages or other communications sent through the Service.

We use this information to provide messaging functionality, maintain the Service, address reports or disputes, enforce our Terms and Conditions, and help protect users from abuse.

E. Information Collected Automatically
Brisio and its service providers may automatically receive limited technical information when you use the Service, such as:
- Device type
- Operating system and version
- Application version
- IP address
- General technical information
- Error and crash information
- Security and authentication information
The exact information collected may depend on the technical services and SDKs used by Brisio.

2. How We Use Information
We may use information we collect to:
- Create and maintain your Brisio account
- Authenticate users
- Provide Brisio's resource-sharing and matching functionality
- Display and manage listings
- Enable communication between users
- Help users discover resources in relevant locations
- Provide customer support
- Respond to questions and requests
- Detect, investigate, and prevent fraud, abuse, or security incidents
- Enforce our Terms and Conditions
- Maintain and improve Brisio
- Diagnose technical problems
- Protect the rights, safety, and security of Brisio and its users
- Comply with applicable laws and legal obligations
We will not use personal information for purposes materially different from those described in this Privacy Policy without appropriate notice or other authorization where required by law.

3. How We Share Information
We do not sell your personal information for money.

We may share information in the following circumstances.

A. With Service Providers
We may use third-party service providers that help us operate Brisio.

Brisio currently uses Supabase for backend services such as authentication, database functionality, and related infrastructure.

Supabase may process information on our behalf as necessary to provide these services.

You can learn more about Supabase's security practices in its documentation and security materials.

B. With Other Brisio Users
Some information may be shared with other Brisio users when necessary for Brisio's functionality.

For example, information associated with a resource listing may be displayed to other users so that they can understand and interact with the listing.

Information contained in messages may be available to the intended recipients of those messages.

Users should assume that information they voluntarily place in listings or otherwise make available through Brisio may be visible to other authorized users.

C. Legal Requirements
We may disclose information if we reasonably believe disclosure is necessary to:
- Comply with applicable law, regulation, legal process, or governmental request
- Protect the rights, property, or safety of Brisio, our users, or others
- Investigate fraud, security issues, or abuse
- Enforce our agreements and policies

D. Business Transfers
If Brisio is involved in a merger, acquisition, financing, reorganization, sale of assets, or similar transaction, information may be transferred as part of that transaction, subject to applicable law.

4. Data Security
We take reasonable administrative, technical, and organizational measures designed to protect personal information against unauthorized access, loss, misuse, alteration, or disclosure.

However, no electronic storage or transmission system can be guaranteed to be completely secure.

You are responsible for maintaining the confidentiality of your account credentials and should notify us if you believe your account has been compromised.

Brisio uses Supabase as part of its backend infrastructure. Supabase provides security controls for its platform, including controls applicable to database, authentication, storage, and related services.

5. Data Retention
We retain personal information for as long as reasonably necessary to provide the Service, maintain accounts, comply with legal obligations, resolve disputes, enforce agreements, prevent abuse, and protect our legitimate interests.

When information is no longer reasonably necessary for these purposes, we may delete, anonymize, or otherwise dispose of it in accordance with applicable law.

Some information may need to be retained for a limited period after account deletion when required by law or reasonably necessary for legitimate purposes such as fraud prevention, security, dispute resolution, or legal compliance.

6. Account Deletion
You may request deletion of your Brisio account and associated personal information.

Brisio provides account-deletion functionality in the app through the Delete Account page.

When an account is deleted, we will delete or de-identify associated personal information that we are not required or permitted to retain.

Some information may remain for a limited period where necessary to comply with legal obligations, resolve disputes, prevent fraud or abuse, maintain security, or otherwise fulfill a lawful purpose.

Deleting your account may also remove listings, messages, profile information, and other content associated with your account where applicable.

7. Your Privacy Choices
Depending on applicable law, you may have rights regarding your personal information, including the right to:
- Request access to personal information we maintain about you
- Request correction of inaccurate information
- Request deletion of your information
- Request information about how your information is used or shared
- Object to or restrict certain processing
- Withdraw consent where processing is based on consent
You may exercise available rights by contacting us at: hariniik24@gmail.com

We may need to verify your identity before fulfilling certain requests.

8. Communications
We may use your email address or phone number to provide account-related communications, security notifications, service announcements, and responses to support requests.

We will not use your contact information for unrelated promotional purposes unless permitted by applicable law and, where required, with your consent.

9. Children's Privacy
Brisio is not intended for children under the age of 13.

We do not knowingly collect personal information from children under 13.

If you believe that a child under 13 has provided personal information to Brisio, please contact us at: hariniik24@gmail.com

If we become aware that we have collected personal information from a child under 13 without appropriate authorization, we will take reasonable steps to delete that information.

If Brisio's intended age range or user eligibility changes, this section will be updated accordingly.

10. Third-Party Services
Brisio may rely on third-party services to operate certain features.

Our current backend provider is Supabase, used for services including authentication, database infrastructure, and related backend functionality.

As Brisio develops, we may add additional services such as analytics, crash reporting, email delivery, cloud storage, or other infrastructure providers.

If we add services that collect or process personal information, we will update this Privacy Policy and our applicable privacy disclosures as required.

11. App Store Privacy Information
Brisio's privacy disclosures in Apple's App Store are intended to accurately describe the data practices of the current version of the application.

Because data practices can change as Brisio adds or removes functionality, App Store privacy information may be updated when necessary.

12. International Users
Brisio may be accessible to users in locations outside the United States.

Depending on where you live, you may have additional privacy rights under applicable privacy laws.

If you are located in the European Economic Area, United Kingdom, California, or another jurisdiction with specific privacy requirements, additional rights and disclosures may apply.

13. California Privacy Rights
If applicable California privacy laws apply to you, you may have rights concerning the collection, use, disclosure, correction, and deletion of your personal information.

Brisio does not sell personal information for monetary consideration.

If Brisio's data practices change in a manner that creates additional obligations under California privacy law, this Privacy Policy will be updated accordingly.

California residents may contact us regarding applicable privacy requests at: hariniik24@gmail.com

14. Changes to This Privacy Policy
We may update this Privacy Policy from time to time.

When we make changes, we may update the Last Updated date at the beginning of this Privacy Policy.

If we make material changes, we may provide additional notice through the Service or other appropriate means where required by law.

Your continued use of Brisio after an updated Privacy Policy becomes effective means that you acknowledge the updated policy, subject to applicable law.

15. Contact Us
If you have questions, concerns, or requests regarding this Privacy Policy or Brisio's privacy practices, contact us at:

Brisio
Email: hariniik24@gmail.com
Website: [BRISIO WEBSITE URL]

For privacy-specific requests, please include Privacy Request in the subject line of your email.

Last Updated: August 11, 2026`;

  return (
    <StackScreenShell>
        <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Privacy Policy</ThemedText>
        <ThemedText type="small" style={styles.bodyText}>{policyText}</ThemedText>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignSelf: 'flex-start',
  },
  bodyText: {
    lineHeight: 20,
  },
});