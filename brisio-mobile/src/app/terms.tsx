import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';

export default function TermsScreen() {
  const router = useRouter();
  const termsText = `Brisio Terms and Conditions
Effective Date: August 11, 2026
Last Updated: August 11, 2026

Welcome to Brisio.

These Terms and Conditions ("Terms") govern your access to and use of the Brisio mobile application and related services (collectively, the "Service").

By creating an account or using Brisio, you agree to these Terms. If you do not agree to these Terms, you should not use the Service.

"Brisio," "we," "us," and "our" refer to the operator of Brisio.

1. About Brisio
Brisio is a platform designed to help businesses, organizations, and other users connect available resources with people or organizations that may need them.

Brisio may facilitate the discovery, listing, communication, and coordination of resources.

Unless explicitly stated otherwise, Brisio does not own, manufacture, inspect, guarantee, endorse, or provide every resource listed by users.

Brisio is a platform and does not automatically become a party to agreements or arrangements made between users.

2. Eligibility
You must meet the legal requirements applicable to you to create and use a Brisio account.

You may not use Brisio if you are prohibited from doing so under applicable law.

If you are using Brisio on behalf of a business or organization, you represent that you have appropriate authority to act on behalf of that organization.

3. Creating an Account
Certain Brisio features require an account.

When creating an account, you agree to provide information that is accurate, current, and complete.

You may be required to provide information such as:
- Name
- Email address
- Phone number
- Organization or business name
- Address
- City
- State
- ZIP code
You are responsible for keeping your account information accurate.

You are also responsible for maintaining the security of your password and account credentials.

You should not share your password with another person.

If you believe someone has accessed your account without permission, you should contact Brisio promptly.

4. Resource Listings
Brisio allows users to create listings for resources that may be available to other users.

You are responsible for the accuracy and legality of any listing you create.

You agree not to create listings that:
- Are intentionally false or misleading
- Misrepresent the availability or condition of a resource
- Infringe another person's intellectual property rights
- Contain unlawful content
- Contain malicious software or harmful code
- Promote fraud or scams
- Violate applicable laws or regulations
- Include unnecessary sensitive personal information
- Facilitate prohibited or dangerous activity
- Violate these Terms
Brisio may remove or restrict listings that violate these Terms or create safety, legal, or security concerns.

5. User Communications
Brisio may allow users to communicate through in-app messaging.

You agree to use messaging features responsibly.

You may not use Brisio messaging to:
- Harass, threaten, intimidate, or abuse another person
- Send spam
- Conduct fraud
- Impersonate another person or organization
- Send unlawful content
- Distribute malicious software
- Attempt to obtain another user's account credentials
- Share another person's private information without authorization
- Engage in discriminatory or hateful conduct
Brisio may investigate reports of abuse and take appropriate action.

6. User-Generated Content
You may submit content to Brisio, including listings, descriptions, messages, business information, and other materials ("User Content").

You retain ownership of User Content that you own.

By submitting User Content to Brisio, you grant Brisio a non-exclusive, worldwide, royalty-free license to host, store, reproduce, display, transmit, and otherwise use that User Content as reasonably necessary to operate, maintain, improve, and provide the Service.

This license ends when your User Content is deleted, except to the extent that retention is reasonably necessary for legal, security, backup, dispute-resolution, or other legitimate purposes.

You represent that you have the rights and permissions necessary to submit the User Content you provide.

7. Content Moderation and Reporting
Because Brisio may contain user-generated listings and communications, we may review or respond to reports concerning content that violates these Terms.

Brisio may:
- Remove content
- Restrict visibility of content
- Suspend accounts
- Terminate accounts
- Block users
- Investigate reports
- Take other reasonable measures to protect users and the Service
If Brisio includes a reporting feature, users should use it to report inappropriate, abusive, fraudulent, or otherwise prohibited content.

You may also contact: hariniik24@gmail.com

Apple's App Store guidelines require apps with user-generated content to provide mechanisms for filtering objectionable material, reporting offensive content, responding to concerns, and blocking abusive users. Brisio will maintain functionality appropriate to its user-generated-content features.

8. Transactions and Arrangements Between Users
Brisio may help users discover and communicate about resources.

However, unless Brisio explicitly states otherwise, Brisio is not responsible for agreements, transactions, exchanges, deliveries, payments, services, or other arrangements made directly between users.

Users are responsible for determining whether a resource, organization, or proposed arrangement is appropriate and lawful.

Brisio does not guarantee:
- The accuracy of a listing
- The availability of a resource
- The quality or condition of a resource
- The identity or reliability of another user
- That a transaction or arrangement will be completed
- That a resource will meet a user's expectations
Users should independently evaluate arrangements before proceeding.

9. Prohibited Conduct
You may not use Brisio to:
1. Violate any applicable law or regulation.
2. Commit fraud or deception.
3. Impersonate another person or organization.
4. Access another user's account without permission.
5. Attempt to obtain passwords or authentication credentials.
6. Interfere with or disrupt the Service.
7. Introduce malware, viruses, or harmful code.
8. Scrape or collect user information without authorization.
9. Circumvent security measures.
10. Harass, threaten, or abuse other users.
11. Post knowingly false or misleading information.
12. Infringe intellectual property rights.
13. Use Brisio for unlawful purposes.
14. Attempt to reverse engineer or improperly access Brisio's systems.
15. Use Brisio in a manner that could damage the Service or its users.

10. Intellectual Property
Brisio and its original software, design, branding, logos, graphics, text, interfaces, and other materials are owned by or licensed to Brisio and are protected by applicable intellectual property laws.

Except as expressly permitted by these Terms, you may not:
- Copy Brisio's software or design
- Modify Brisio's proprietary materials
- Distribute Brisio's proprietary materials
- Reverse engineer the Service
- Use Brisio's trademarks without permission
- Create derivative works from Brisio's proprietary software or materials
Nothing in these Terms transfers ownership of Brisio's intellectual property to you.

11. Feedback
If you voluntarily provide suggestions, ideas, or feedback regarding Brisio, you agree that Brisio may use that feedback without compensation or restriction, provided that doing so does not violate applicable law.

12. Privacy
Your use of Brisio is also governed by the Brisio Privacy Policy.

The Privacy Policy explains how Brisio collects, uses, stores, and shares personal information.

You can access the Privacy Policy at: /privacy-policy

13. Account Suspension and Termination
You may stop using Brisio at any time.

You may also delete your account through the account-deletion functionality provided within the Service.

Brisio may suspend or terminate an account if we reasonably believe that the user:
- Violated these Terms
- Engaged in fraud or abuse
- Created a security risk
- Used Brisio unlawfully
- Harmed or threatened other users
- Misused the Service
- Provided materially false information
- Attempted to interfere with Brisio's systems
Where appropriate, Brisio may provide notice before suspension or termination, but immediate action may be taken when reasonably necessary to protect users, the Service, or comply with legal obligations.

14. Account Deletion
You may initiate deletion of your Brisio account through the account settings or other account-management functionality provided within the app.

Deleting your account may result in the deletion of associated personal information, listings, messages, and other account-related content, subject to applicable legal, security, dispute-resolution, and retention requirements.

Apple requires iOS applications that support account creation to provide users with a way to initiate account deletion within the app. Brisio maintains an in-app account deletion mechanism.

15. Disclaimers
Brisio is provided on an as is and as available basis to the extent permitted by applicable law.

We do not guarantee that:
- Brisio will always be available
- Brisio will operate without interruption
- Brisio will be error-free
- Listings will always be accurate
- Users will behave appropriately
- Resources will be available when requested
- Communications between users will result in a successful arrangement
You are responsible for evaluating information and interactions made available through the Service.

16. Limitation of Liability
To the maximum extent permitted by applicable law, Brisio and its operators, developers, affiliates, service providers, and representatives will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising from or related to your use of the Service.

To the maximum extent permitted by applicable law, Brisio's total liability arising from your use of the Service will be limited to the amount you paid to Brisio for use of the Service during the applicable period, or, if you have not paid Brisio anything, the minimum amount permitted under applicable law.

Nothing in these Terms is intended to exclude liability that cannot legally be excluded or limited.

17. Indemnification
To the extent permitted by applicable law, you agree to defend, indemnify, and hold harmless Brisio and its operators, affiliates, service providers, and representatives from claims, damages, liabilities, losses, and expenses arising from:
- Your violation of these Terms
- Your User Content
- Your misuse of the Service
- Your violation of another person's rights
- Your violation of applicable law
This provision applies only to the extent permitted by applicable law.

18. Third-Party Services
Brisio may use third-party services, including Supabase, to provide infrastructure, authentication, database, security, hosting, or other functionality.

Your use of Brisio may therefore be subject to certain third-party terms or policies.

Brisio is not responsible for the independent practices of third-party services outside of Brisio's control.

19. Changes to Brisio
We may modify, suspend, or discontinue all or part of Brisio at any time.

We may also add, remove, or modify features.

Where required by law, we will provide appropriate notice of material changes.

20. Changes to These Terms
We may update these Terms from time to time.

When we update them, we may change the Last Updated date above.

If material changes are made, we may provide additional notice through Brisio or other appropriate means.

Your continued use of Brisio after updated Terms become effective constitutes acceptance of the updated Terms, subject to applicable law.

21. Governing Law
These Terms will be governed by the laws of [STATE], without regard to conflict-of-law principles, except where applicable law requires otherwise.

Any dispute that cannot otherwise be resolved will be handled in the courts located in [COUNTY/STATE], unless applicable law requires a different venue.

22. Severability
If any provision of these Terms is determined to be invalid or unenforceable, the remaining provisions will remain in effect to the fullest extent permitted by law.

23. Entire Agreement
These Terms and the Brisio Privacy Policy constitute the agreement between you and Brisio regarding your use of the Service, except where additional terms are expressly provided for a particular feature.

24. Contact Us
If you have questions, concerns, reports, or requests regarding Brisio or these Terms, contact us at:

Brisio
Email: hariniik24@gmail.com
Website: [BRISIO WEBSITE URL]

For reports concerning abusive, fraudulent, or prohibited content, please include sufficient information for us to investigate the concern.

Last Updated: August 11, 2026`;

  return (
    <StackScreenShell>
        <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Terms and Conditions</ThemedText>
        <ThemedText type="small" style={styles.bodyText}>{termsText}</ThemedText>
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