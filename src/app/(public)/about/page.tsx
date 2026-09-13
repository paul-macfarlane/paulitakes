import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Meet Paulitakes: sports analysis, storytelling, and cheap laughs from Paul and guest authors. Read about the site and how to join the conversation.",
  alternates: { canonical: "/about" },
};

// Plain-prose explainer added for Google's OAuth branding review (BRAND-4):
// the app's purpose and its use of provider account data must be spelled out
// on a public page, in addition to the home-page blurb that links here.
export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <article className="prose dark:prose-invert">
        <h1>About Paulitakes</h1>
        <p>
          Paulitakes is a sports blog for people who take the games seriously
          but can still laugh at how much they care. I&apos;m Paul, and I write
          about sports through analysis, stories, and jokes that occasionally
          deserve a better editor.
        </p>
        <p>
          Sometimes that means digging into why a team works. Sometimes it means
          a personal story, a ridiculous comparison, or trying to make sense of
          a loss that should not have ruined my evening. Guest authors join in
          too. The point is to have something to say and make it worth your time
          to read.
        </p>

        <h2>What you can do here</h2>
        <p>
          Everything published is free to read, no account needed. You can
          browse the feed, filter by category, and search every post. If a take
          demands a response, sign in and leave a comment or a like.
        </p>

        <h2>Accounts &amp; sign-in</h2>
        <p>
          Commenting and liking require an account so conversations have real
          participants. You sign in with Google or Discord — there&apos;s no
          email/password option, and we never see your password. When you sign
          in, your provider shares only your basic profile with us: your name,
          email address, and avatar. That&apos;s all we use it for — showing
          who&apos;s talking. We never post anywhere on your behalf, and we
          don&apos;t run ads or sell personal data. The full details are in the{" "}
          <Link href="/privacy">privacy policy</Link> and{" "}
          <Link href="/terms">terms of service</Link>.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, corrections, or a take you need to dispute in writing?
          Email{" "}
          <a href="mailto:paulitakesweb@gmail.com">paulitakesweb@gmail.com</a>.
        </p>
      </article>
    </main>
  );
}
